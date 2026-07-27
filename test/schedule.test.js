import test from "node:test";
import assert from "node:assert/strict";

import { reorderAnchor, reorderTasks, rescheduleTasks } from "../schedule.js";

const tasks = [
  {
    id: "security",
    minutes: 60,
    startAt: "2026-07-27T15:00:00.000Z",
    endAt: "2026-07-27T16:00:00.000Z",
  },
  {
    id: "email",
    minutes: 30,
    startAt: "2026-07-27T16:00:00.000Z",
    endAt: "2026-07-27T16:30:00.000Z",
  },
  {
    id: "project",
    minutes: 90,
    startAt: "2026-07-27T16:30:00.000Z",
    endAt: "2026-07-27T18:00:00.000Z",
  },
];

test("moves a missed first task to the end without pulling later tasks earlier", () => {
  const reordered = reorderTasks(tasks, "security", "project", "after");
  const anchor = reorderAnchor(tasks, "security", reordered);
  const scheduled = rescheduleTasks(reordered, anchor);

  assert.deepEqual(
    scheduled.map(({ id, startAt, endAt, sort_order }) => ({
      id,
      startAt,
      endAt,
      sort_order,
    })),
    [
      {
        id: "email",
        startAt: "2026-07-27T16:00:00.000Z",
        endAt: "2026-07-27T16:30:00.000Z",
        sort_order: 0,
      },
      {
        id: "project",
        startAt: "2026-07-27T16:30:00.000Z",
        endAt: "2026-07-27T18:00:00.000Z",
        sort_order: 1,
      },
      {
        id: "security",
        startAt: "2026-07-27T18:00:00.000Z",
        endAt: "2026-07-27T19:00:00.000Z",
        sort_order: 2,
      },
    ],
  );
});

test("inserts a task between two tasks and shifts every following time", () => {
  const reordered = reorderTasks(tasks, "project", "security", "after");
  const anchor = reorderAnchor(tasks, "project", reordered);
  const scheduled = rescheduleTasks(reordered, anchor);

  assert.deepEqual(
    scheduled.map((task) => [task.id, task.startAt, task.endAt]),
    [
      ["security", "2026-07-27T15:00:00.000Z", "2026-07-27T16:00:00.000Z"],
      ["project", "2026-07-27T16:00:00.000Z", "2026-07-27T17:30:00.000Z"],
      ["email", "2026-07-27T17:30:00.000Z", "2026-07-27T18:00:00.000Z"],
    ],
  );
});

test("moving a later task to the top keeps the original day start", () => {
  const reordered = reorderTasks(tasks, "project", "security", "before");
  const anchor = reorderAnchor(tasks, "project", reordered);
  const scheduled = rescheduleTasks(reordered, anchor);

  assert.equal(scheduled[0].id, "project");
  assert.equal(scheduled[0].startAt, tasks[0].startAt);
  assert.equal(scheduled[1].startAt, scheduled[0].endAt);
  assert.equal(scheduled[2].startAt, scheduled[1].endAt);
});

test("rejects an invalid destination instead of losing the moved task", () => {
  assert.throws(
    () => reorderTasks(tasks, "security", "missing", "before"),
    /destination task was not found/i,
  );
});
