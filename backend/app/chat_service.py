import copy
import json
import re
import uuid
from collections import Counter
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.ai_client import request_chat_completion
from app.board_store import (
    WorkspaceConflictError,
    WorkspaceDeletionError,
    WorkspaceNotFoundError,
    create_workspace_for_user,
    delete_workspace_for_user,
    get_or_create_board_for_workspace,
    list_workspaces_for_user,
    save_board_for_workspace,
)

MAX_HISTORY_MESSAGES = 12


class ChatServiceError(Exception):
    pass


class ChatResponseFormatError(ChatServiceError):
    pass


class ChatOperationError(ChatServiceError):
    pass


class CreateOperation(BaseModel):
    type: Literal["create"]
    title: str = Field(min_length=1)
    details: str = ""
    columnId: str = Field(min_length=1)
    index: int | None = None


class EditOperation(BaseModel):
    type: Literal["edit"]
    cardId: str = Field(min_length=1)
    title: str | None = None
    details: str | None = None

    @model_validator(mode="after")
    def validate_changes(self) -> "EditOperation":
        if self.title is None and self.details is None:
            raise ValueError("Edit operation must include title and/or details.")
        return self


class MoveOperation(BaseModel):
    type: Literal["move"]
    cardId: str = Field(min_length=1)
    columnId: str = Field(min_length=1)
    index: int | None = None


class DeleteOperation(BaseModel):
    type: Literal["delete"]
    cardId: str = Field(min_length=1)


class CreateColumnOperation(BaseModel):
    type: Literal["create_column"]
    title: str = Field(min_length=1)
    index: int | None = None


class DeleteColumnOperation(BaseModel):
    type: Literal["delete_column"]
    columnId: str = Field(min_length=1)
    targetColumnId: str | None = None


class CreateWorkspaceOperation(BaseModel):
    type: Literal["create_workspace"]
    name: str = Field(min_length=2)


class DeleteWorkspaceOperation(BaseModel):
    type: Literal["delete_workspace"]
    workspaceId: int | None = Field(default=None, ge=1)


BoardOperationModel = (
    CreateOperation
    | EditOperation
    | MoveOperation
    | DeleteOperation
    | CreateColumnOperation
    | DeleteColumnOperation
)

OperationModel = Annotated[
    BoardOperationModel | CreateWorkspaceOperation | DeleteWorkspaceOperation,
    Field(discriminator="type"),
]


class StructuredAIResponse(BaseModel):
    message: str = Field(min_length=1)
    operations: list[OperationModel] = Field(default_factory=list)


def process_chat_request(
    user_id: int,
    workspace_id: int,
    user_message: str,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    workspaces = list_workspaces_for_user(user_id)
    board, current_version = get_or_create_board_for_workspace(user_id, workspace_id)
    prompt = build_chat_prompt(workspaces, workspace_id, board, user_message, history or [])
    raw_response = request_chat_completion(prompt)
    structured = parse_structured_ai_response(raw_response)

    (
        updated_workspaces,
        selected_workspace_id,
        updated_board,
        next_version,
        applied_operations,
    ) = execute_operations(
        user_id=user_id,
        workspace_id=workspace_id,
        board=board,
        current_version=current_version,
        operations=structured.operations,
    )

    return {
        "message": structured.message,
        "operations": applied_operations,
        "workspaces": updated_workspaces,
        "selectedWorkspaceId": selected_workspace_id,
        "board": updated_board,
        "version": next_version,
    }


def build_chat_prompt(
    workspaces: list[dict[str, Any]],
    current_workspace_id: int,
    board: dict[str, Any],
    user_message: str,
    history: list[dict[str, str]],
) -> str:
    trimmed_history = history[-MAX_HISTORY_MESSAGES:]
    current_workspace = next(
        (workspace for workspace in workspaces if int(workspace["id"]) == current_workspace_id),
        None,
    )

    instructions = (
        "You are a project management assistant for a Kanban workspace.\n"
        "Return ONLY valid JSON with this exact shape:\n"
        '{"message":"assistant text","operations":[...]}'
        "\n"
        "Allowed operation objects:\n"
        '- {"type":"create","title":"...","details":"...","columnId":"...","index":0}\n'
        '- {"type":"edit","cardId":"...","title":"...","details":"..."}\n'
        '- {"type":"move","cardId":"...","columnId":"...","index":0}\n'
        '- {"type":"delete","cardId":"..."}\n'
        '- {"type":"create_column","title":"...","index":0}\n'
        '- {"type":"delete_column","columnId":"...","targetColumnId":"..."}\n'
        '- {"type":"create_workspace","name":"..."}\n'
        '- {"type":"delete_workspace","workspaceId":1}\n'
        "Rules:\n"
        "- Card and column operations apply only to the current workspace.\n"
        "- Creating a workspace does not switch the active workspace.\n"
        "- Deleting the current workspace switches to the fallback workspace returned by the app.\n"
        "- Use only workspace ids, column ids, and card ids that already exist unless creating one.\n"
        "- Do not delete the last workspace or the last column.\n"
        "- Do not include markdown or code fences.\n"
        "- If no app change is needed, return operations as an empty array.\n"
        "- Keep message concise and clear.\n"
    )

    return (
        f"{instructions}\n"
        f"Current workspace:\n{json.dumps(current_workspace, ensure_ascii=True)}\n\n"
        f"All workspaces JSON:\n{json.dumps(workspaces, ensure_ascii=True)}\n\n"
        f"Current board JSON:\n{json.dumps(board, ensure_ascii=True)}\n\n"
        f"Conversation history JSON:\n{json.dumps(trimmed_history, ensure_ascii=True)}\n\n"
        f"Latest user message:\n{user_message}"
    )


def parse_structured_ai_response(raw_response: str) -> StructuredAIResponse:
    payload = _extract_json_payload(raw_response)
    try:
        return StructuredAIResponse.model_validate(payload)
    except ValidationError as error:
        raise ChatResponseFormatError("AI response does not match required schema.") from error


def apply_operations(
    board: dict[str, Any],
    operations: list[OperationModel],
) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    updated_board = copy.deepcopy(board)
    _assert_board_integrity(updated_board)

    applied_operations: list[dict[str, Any]] = []
    for operation in operations:
        if isinstance(operation, (CreateWorkspaceOperation, DeleteWorkspaceOperation)):
            raise ChatOperationError("Workspace operations require persisted workspace context.")
        applied_operations.append(_apply_board_operation(updated_board, operation))

    _assert_board_integrity(updated_board)
    return updated_board, applied_operations


def execute_operations(
    user_id: int,
    workspace_id: int,
    board: dict[str, Any],
    current_version: int,
    operations: list[OperationModel],
) -> tuple[list[dict[str, Any]], int, dict[str, Any], int, list[dict[str, Any]]]:
    workspaces = list_workspaces_for_user(user_id)
    selected_workspace_id = workspace_id
    active_board = copy.deepcopy(board)
    active_version = current_version
    board_dirty = False
    applied_operations: list[dict[str, Any]] = []

    _assert_board_integrity(active_board)

    for operation in operations:
        if isinstance(operation, (CreateWorkspaceOperation, DeleteWorkspaceOperation)):
            if board_dirty:
                active_version = save_board_for_workspace(
                    user_id,
                    selected_workspace_id,
                    active_board,
                    active_version,
                )
                board_dirty = False

            try:
                if isinstance(operation, CreateWorkspaceOperation):
                    workspace = create_workspace_for_user(user_id, operation.name)
                    workspaces = list_workspaces_for_user(user_id)
                    applied_operations.append(
                        {
                            "type": "create_workspace",
                            "workspaceId": int(workspace["id"]),
                            "name": workspace["name"],
                        }
                    )
                else:
                    target_workspace_id = operation.workspaceId or selected_workspace_id
                    workspaces, fallback_workspace_id = delete_workspace_for_user(
                        user_id,
                        target_workspace_id,
                    )
                    if target_workspace_id == selected_workspace_id:
                        selected_workspace_id = fallback_workspace_id
                        active_board, active_version = get_or_create_board_for_workspace(
                            user_id,
                            selected_workspace_id,
                        )
                    applied_operations.append(
                        {
                            "type": "delete_workspace",
                            "workspaceId": target_workspace_id,
                            "selectedWorkspaceId": selected_workspace_id,
                        }
                    )
            except (
                WorkspaceConflictError,
                WorkspaceDeletionError,
                WorkspaceNotFoundError,
            ) as error:
                raise ChatOperationError(str(error)) from error

            continue

        applied_operations.append(_apply_board_operation(active_board, operation))
        board_dirty = True

    if board_dirty:
        active_version = save_board_for_workspace(
            user_id,
            selected_workspace_id,
            active_board,
            active_version,
        )

    return workspaces, selected_workspace_id, active_board, active_version, applied_operations


def _apply_board_operation(
    board: dict[str, Any],
    operation: BoardOperationModel,
) -> dict[str, Any]:
    if isinstance(operation, CreateOperation):
        return _apply_create(board, operation)
    if isinstance(operation, EditOperation):
        return _apply_edit(board, operation)
    if isinstance(operation, MoveOperation):
        return _apply_move(board, operation)
    if isinstance(operation, DeleteOperation):
        return _apply_delete(board, operation)
    if isinstance(operation, CreateColumnOperation):
        return _apply_create_column(board, operation)
    if isinstance(operation, DeleteColumnOperation):
        return _apply_delete_column(board, operation)
    raise ChatOperationError("Unsupported operation type.")


def _extract_json_payload(raw_response: str) -> dict[str, Any]:
    stripped = raw_response.strip()

    try:
        payload = json.loads(stripped)
        if isinstance(payload, dict):
            return payload
    except json.JSONDecodeError:
        pass

    fenced_match = re.search(r"```(?:json)?\s*(\{.*\})\s*```", stripped, flags=re.DOTALL)
    if fenced_match:
        candidate = fenced_match.group(1).strip()
        try:
            payload = json.loads(candidate)
            if isinstance(payload, dict):
                return payload
        except json.JSONDecodeError as error:
            raise ChatResponseFormatError("AI response contains invalid JSON.") from error

    first_brace = stripped.find("{")
    last_brace = stripped.rfind("}")
    if first_brace == -1 or last_brace == -1 or first_brace >= last_brace:
        raise ChatResponseFormatError("AI response is not JSON.")

    candidate = stripped[first_brace : last_brace + 1]
    try:
        payload = json.loads(candidate)
    except json.JSONDecodeError as error:
        raise ChatResponseFormatError("AI response contains invalid JSON.") from error

    if not isinstance(payload, dict):
        raise ChatResponseFormatError("AI response JSON must be an object.")
    return payload


def _apply_create(board: dict[str, Any], operation: CreateOperation) -> dict[str, Any]:
    target_column = _get_column_or_raise(board, operation.columnId)
    card_id = _generate_card_id(board)

    board_cards = board["cards"]
    board_cards[card_id] = {
        "id": card_id,
        "title": operation.title,
        "details": operation.details,
    }

    target_ids = target_column["cardIds"]
    insert_index = _normalize_insert_index(operation.index, len(target_ids))
    target_ids.insert(insert_index, card_id)

    return {
        "type": "create",
        "cardId": card_id,
        "title": operation.title,
        "details": operation.details,
        "columnId": operation.columnId,
        "index": insert_index,
    }


def _apply_edit(board: dict[str, Any], operation: EditOperation) -> dict[str, Any]:
    card = board["cards"].get(operation.cardId)
    if not isinstance(card, dict):
        raise ChatOperationError(f"Cannot edit unknown card '{operation.cardId}'.")

    if operation.title is not None:
        card["title"] = operation.title
    if operation.details is not None:
        card["details"] = operation.details

    return {
        "type": "edit",
        "cardId": operation.cardId,
        "title": card["title"],
        "details": card["details"],
    }


def _apply_move(board: dict[str, Any], operation: MoveOperation) -> dict[str, Any]:
    target_column = _get_column_or_raise(board, operation.columnId)
    source_column, source_index = _find_card_location_or_raise(board, operation.cardId)

    source_column["cardIds"].pop(source_index)
    destination_ids = target_column["cardIds"]
    insert_index = _normalize_insert_index(operation.index, len(destination_ids))
    destination_ids.insert(insert_index, operation.cardId)

    return {
        "type": "move",
        "cardId": operation.cardId,
        "columnId": operation.columnId,
        "index": insert_index,
    }


def _apply_delete(board: dict[str, Any], operation: DeleteOperation) -> dict[str, Any]:
    if operation.cardId not in board["cards"]:
        raise ChatOperationError(f"Cannot delete unknown card '{operation.cardId}'.")

    del board["cards"][operation.cardId]
    for column in board["columns"]:
        column["cardIds"] = [card_id for card_id in column["cardIds"] if card_id != operation.cardId]

    return {"type": "delete", "cardId": operation.cardId}


def _apply_create_column(board: dict[str, Any], operation: CreateColumnOperation) -> dict[str, Any]:
    column_id = _generate_column_id(board)
    insert_index = _normalize_insert_index(operation.index, len(board["columns"]))
    board["columns"].insert(
        insert_index,
        {
            "id": column_id,
            "title": operation.title,
            "cardIds": [],
        },
    )
    return {
        "type": "create_column",
        "columnId": column_id,
        "title": operation.title,
        "index": insert_index,
    }


def _apply_delete_column(board: dict[str, Any], operation: DeleteColumnOperation) -> dict[str, Any]:
    columns = board["columns"]
    if len(columns) <= 1:
        raise ChatOperationError("Cannot delete the last column.")

    column_index = next(
        (index for index, column in enumerate(columns) if column.get("id") == operation.columnId),
        -1,
    )
    if column_index == -1:
        raise ChatOperationError(f"Unknown column '{operation.columnId}'.")

    removed_column = columns[column_index]
    if operation.targetColumnId is not None:
        if operation.targetColumnId == operation.columnId:
            raise ChatOperationError("targetColumnId must be different from columnId.")
        recipient_column = _get_column_or_raise(board, operation.targetColumnId)
        recipient_column["cardIds"].extend(removed_column["cardIds"])
        recipient_column_id = operation.targetColumnId
    else:
        if column_index == 0:
            recipient_column = columns[1]
            recipient_column["cardIds"] = [
                *removed_column["cardIds"],
                *recipient_column["cardIds"],
            ]
        else:
            recipient_column = columns[column_index - 1]
            recipient_column["cardIds"].extend(removed_column["cardIds"])
        recipient_column_id = str(recipient_column["id"])

    board["columns"] = [column for column in columns if column.get("id") != operation.columnId]

    return {
        "type": "delete_column",
        "columnId": operation.columnId,
        "targetColumnId": recipient_column_id,
    }


def _generate_card_id(board: dict[str, Any]) -> str:
    cards = board["cards"]
    while True:
        candidate = f"card-{uuid.uuid4().hex[:8]}"
        if candidate not in cards:
            return candidate


def _generate_column_id(board: dict[str, Any]) -> str:
    column_ids = {str(column["id"]) for column in board["columns"]}
    while True:
        candidate = f"col-{uuid.uuid4().hex[:8]}"
        if candidate not in column_ids:
            return candidate


def _normalize_insert_index(index: int | None, length: int) -> int:
    if index is None:
        return length
    if index < 0:
        return 0
    if index > length:
        return length
    return index


def _get_column_or_raise(board: dict[str, Any], column_id: str) -> dict[str, Any]:
    for column in board["columns"]:
        if column.get("id") == column_id:
            return column
    raise ChatOperationError(f"Unknown column '{column_id}'.")


def _find_card_location_or_raise(board: dict[str, Any], card_id: str) -> tuple[dict[str, Any], int]:
    for column in board["columns"]:
        card_ids = column.get("cardIds", [])
        for index, value in enumerate(card_ids):
            if value == card_id:
                return column, index
    raise ChatOperationError(f"Card '{card_id}' is not assigned to a column.")


def _assert_board_integrity(board: dict[str, Any]) -> None:
    columns = board.get("columns")
    cards = board.get("cards")

    if not isinstance(columns, list) or not isinstance(cards, dict):
        raise ChatOperationError("Board structure is invalid.")

    seen_column_ids: set[str] = set()
    for column in columns:
        column_id = column.get("id")
        if not isinstance(column_id, str) or not column_id:
            raise ChatOperationError("Every column must have a non-empty id.")
        if column_id in seen_column_ids:
            raise ChatOperationError(f"Duplicate column id '{column_id}'.")
        seen_column_ids.add(column_id)

    card_ids_from_map = set(cards.keys())
    for card_key, card_value in cards.items():
        if not isinstance(card_value, dict) or card_value.get("id") != card_key:
            raise ChatOperationError("Card map keys must match card.id values.")

    card_ids_from_columns: list[str] = []
    for column in columns:
        card_ids = column.get("cardIds")
        if not isinstance(card_ids, list):
            raise ChatOperationError("Column cardIds must be a list.")
        card_ids_from_columns.extend(card_ids)

    unknown = sorted(set(card_ids_from_columns) - card_ids_from_map)
    if unknown:
        raise ChatOperationError(f"Columns reference unknown cards: {unknown}")

    duplicates = {card_id for card_id, count in Counter(card_ids_from_columns).items() if count > 1}
    if duplicates:
        raise ChatOperationError(f"Cards are assigned more than once: {sorted(duplicates)}")

    unassigned = sorted(card_ids_from_map - set(card_ids_from_columns))
    if unassigned:
        raise ChatOperationError(f"Cards must be assigned to one column: {unassigned}")
