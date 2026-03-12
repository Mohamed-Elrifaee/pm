import { addColumn, moveCard, removeColumn, type Column } from "@/lib/kanban";

describe("moveCard", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1", "card-2"] },
    { id: "col-b", title: "B", cardIds: ["card-3"] },
  ];

  it("reorders cards in the same column", () => {
    const result = moveCard(baseColumns, "card-2", "card-1");
    expect(result[0].cardIds).toEqual(["card-2", "card-1"]);
  });

  it("moves cards to another column", () => {
    const result = moveCard(baseColumns, "card-2", "card-3");
    expect(result[0].cardIds).toEqual(["card-1"]);
    expect(result[1].cardIds).toEqual(["card-2", "card-3"]);
  });

  it("drops cards to the end of a column", () => {
    const result = moveCard(baseColumns, "card-1", "col-b");
    expect(result[0].cardIds).toEqual(["card-2"]);
    expect(result[1].cardIds).toEqual(["card-3", "card-1"]);
  });
});

describe("addColumn", () => {
  it("appends a new empty column", () => {
    const result = addColumn([{ id: "col-a", title: "A", cardIds: [] }], "New lane");
    expect(result).toHaveLength(2);
    expect(result[1].title).toBe("New lane");
    expect(result[1].cardIds).toEqual([]);
  });
});

describe("removeColumn", () => {
  const baseColumns: Column[] = [
    { id: "col-a", title: "A", cardIds: ["card-1"] },
    { id: "col-b", title: "B", cardIds: ["card-2"] },
    { id: "col-c", title: "C", cardIds: ["card-3"] },
  ];

  it("moves removed column cards to the previous column", () => {
    const result = removeColumn(baseColumns, "col-b");
    expect(result).toHaveLength(2);
    expect(result[0].cardIds).toEqual(["card-1", "card-2"]);
  });

  it("moves first-column cards into the next column", () => {
    const result = removeColumn(baseColumns, "col-a");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("col-b");
    expect(result[0].cardIds).toEqual(["card-1", "card-2"]);
  });

  it("does not remove the last remaining column", () => {
    const result = removeColumn([{ id: "col-a", title: "A", cardIds: [] }], "col-a");
    expect(result).toHaveLength(1);
  });
});
