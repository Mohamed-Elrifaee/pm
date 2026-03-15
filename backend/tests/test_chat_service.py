import copy

import pytest

from app.board_store import DEFAULT_BOARD
from app.chat_service import (
    ChatOperationError,
    ChatResponseFormatError,
    apply_operations,
    parse_structured_ai_response,
)


def clone_default_board() -> dict:
    return copy.deepcopy(DEFAULT_BOARD)


def test_parse_structured_ai_response_accepts_code_fenced_json() -> None:
    raw = """
    ```json
    {"message":"ok","operations":[]}
    ```
    """
    parsed = parse_structured_ai_response(raw)
    assert parsed.message == "ok"
    assert parsed.operations == []


def test_parse_structured_ai_response_rejects_non_json() -> None:
    with pytest.raises(ChatResponseFormatError, match="not JSON"):
        parse_structured_ai_response("hello world")


def test_apply_operations_create_adds_card_to_target_column() -> None:
    board = clone_default_board()
    parsed = parse_structured_ai_response(
        '{"message":"created","operations":[{"type":"create","title":"New","details":"d","columnId":"col-backlog","index":0}]}'
    )

    updated, applied = apply_operations(board, parsed.operations)
    assert applied[0]["type"] == "create"
    created_id = applied[0]["cardId"]
    assert updated["columns"][0]["cardIds"][0] == created_id
    assert updated["cards"][created_id]["title"] == "New"


def test_apply_operations_edit_updates_card_fields() -> None:
    board = clone_default_board()
    parsed = parse_structured_ai_response(
        '{"message":"edited","operations":[{"type":"edit","cardId":"card-1","title":"Updated title"}]}'
    )

    updated, applied = apply_operations(board, parsed.operations)
    assert applied[0]["type"] == "edit"
    assert updated["cards"]["card-1"]["title"] == "Updated title"


def test_apply_operations_move_reassigns_card_column() -> None:
    board = clone_default_board()
    parsed = parse_structured_ai_response(
        '{"message":"moved","operations":[{"type":"move","cardId":"card-1","columnId":"col-done","index":0}]}'
    )

    updated, applied = apply_operations(board, parsed.operations)
    assert applied[0]["type"] == "move"
    assert "card-1" not in updated["columns"][0]["cardIds"]
    assert updated["columns"][4]["cardIds"][0] == "card-1"


def test_apply_operations_delete_removes_card_everywhere() -> None:
    board = clone_default_board()
    parsed = parse_structured_ai_response(
        '{"message":"deleted","operations":[{"type":"delete","cardId":"card-1"}]}'
    )

    updated, applied = apply_operations(board, parsed.operations)
    assert applied[0] == {"type": "delete", "cardId": "card-1"}
    assert "card-1" not in updated["cards"]
    assert "card-1" not in updated["columns"][0]["cardIds"]


def test_apply_operations_create_column_inserts_at_requested_index() -> None:
    board = clone_default_board()
    parsed = parse_structured_ai_response(
        '{"message":"lane added","operations":[{"type":"create_column","title":"Blocked","index":1}]}'
    )

    updated, applied = apply_operations(board, parsed.operations)
    assert applied[0]["type"] == "create_column"
    assert updated["columns"][1]["title"] == "Blocked"
    assert updated["columns"][1]["cardIds"] == []


def test_apply_operations_delete_column_moves_cards_to_neighbor() -> None:
    board = clone_default_board()
    parsed = parse_structured_ai_response(
        '{"message":"lane removed","operations":[{"type":"delete_column","columnId":"col-discovery"}]}'
    )

    updated, applied = apply_operations(board, parsed.operations)
    assert applied[0] == {
        "type": "delete_column",
        "columnId": "col-discovery",
        "targetColumnId": "col-backlog",
    }
    assert [column["id"] for column in updated["columns"]] == [
        "col-backlog",
        "col-progress",
        "col-review",
        "col-done",
    ]
    assert updated["columns"][0]["cardIds"] == ["card-1", "card-2", "card-3"]


def test_apply_operations_invalid_move_does_not_mutate_original_board() -> None:
    board = clone_default_board()
    baseline = copy.deepcopy(board)
    parsed = parse_structured_ai_response(
        '{"message":"bad","operations":[{"type":"move","cardId":"missing-card","columnId":"col-done"}]}'
    )

    with pytest.raises(ChatOperationError, match="missing-card"):
        apply_operations(board, parsed.operations)

    assert board == baseline
