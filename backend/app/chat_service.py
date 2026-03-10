import copy
import json
import re
import uuid
from collections import Counter
from typing import Annotated, Any, Literal

from pydantic import BaseModel, Field, ValidationError, model_validator

from app.ai_client import request_chat_completion
from app.board_store import get_or_create_board_for_user, save_board_for_user

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


OperationModel = Annotated[
    CreateOperation | EditOperation | MoveOperation | DeleteOperation,
    Field(discriminator="type"),
]


class StructuredAIResponse(BaseModel):
    message: str = Field(min_length=1)
    operations: list[OperationModel] = Field(default_factory=list)


def process_chat_request(
    username: str,
    user_message: str,
    history: list[dict[str, str]] | None = None,
) -> dict[str, Any]:
    board, current_version = get_or_create_board_for_user(username)
    prompt = build_chat_prompt(board, user_message, history or [])
    raw_response = request_chat_completion(prompt)
    structured = parse_structured_ai_response(raw_response)

    updated_board, applied_operations = apply_operations(board, structured.operations)

    next_version = current_version
    if applied_operations:
        next_version = save_board_for_user(username, updated_board)

    return {
        "message": structured.message,
        "operations": applied_operations,
        "board": updated_board,
        "version": next_version,
    }


def build_chat_prompt(
    board: dict[str, Any],
    user_message: str,
    history: list[dict[str, str]],
) -> str:
    trimmed_history = history[-MAX_HISTORY_MESSAGES:]

    instructions = (
        "You are a project management assistant for a Kanban board.\n"
        "Return ONLY valid JSON with this exact shape:\n"
        '{"message":"assistant text","operations":[...]}'
        "\n"
        "Allowed operation objects:\n"
        '- {"type":"create","title":"...","details":"...","columnId":"...","index":0}\n'
        '- {"type":"edit","cardId":"...","title":"...","details":"..."}\n'
        '- {"type":"move","cardId":"...","columnId":"...","index":0}\n'
        '- {"type":"delete","cardId":"..."}\n'
        "Rules:\n"
        "- Use only cards and columns that exist in the board unless creating a new card.\n"
        "- Do not include markdown or code fences.\n"
        "- If no board change is needed, return operations as an empty array.\n"
        "- Keep message concise and clear.\n"
    )

    return (
        f"{instructions}\n"
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
        if isinstance(operation, CreateOperation):
            applied_operations.append(_apply_create(updated_board, operation))
        elif isinstance(operation, EditOperation):
            applied_operations.append(_apply_edit(updated_board, operation))
        elif isinstance(operation, MoveOperation):
            applied_operations.append(_apply_move(updated_board, operation))
        elif isinstance(operation, DeleteOperation):
            applied_operations.append(_apply_delete(updated_board, operation))
        else:
            raise ChatOperationError("Unsupported operation type.")

    _assert_board_integrity(updated_board)
    return updated_board, applied_operations


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


def _generate_card_id(board: dict[str, Any]) -> str:
    cards = board["cards"]
    while True:
        candidate = f"card-{uuid.uuid4().hex[:8]}"
        if candidate not in cards:
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
