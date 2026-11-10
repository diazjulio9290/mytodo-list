import test from "node:test";
import assert from "node:assert/strict";

import {
  gapStarts,
  gapStartsAfterRemoval,
  nextTaskStart,
  reorderAnchor,
  reorderTasks,
  rescheduleTasks,
} from "../schedule.js";

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

// A day with idle time: "late" was added at 2pm, long after "email" ended at 9:30am.
const gappedTasks = [
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
    id: "late",
    minutes: 45,
    startAt: "2026-07-27T21:00:00.000Z",
    endAt: "2026-07-27T21:45:00.000Z",
  },
  {
    id: "wrap",
    minutes: 15,
    startAt: "2026-07-27T21:45:00.000Z",
    endAt: "2026-07-27T22:00:00.000Z",
  },
];

test("a task added after the last one ended starts now, not in the past", () => {
  const now = new Date("2026-07-27T21:00:00.000Z");
  const start = nextTaskStart(tasks, now, now);
  assert.equal(start.toISOString(), "2026-07-27T21:00:00.000Z");
});

test("a task added while the plan is still running starts when the last one ends", () => {
  const now = new Date("2026-07-27T15:30:00.000Z");
  const start = nextTaskStart(tasks, now, now);
  assert.equal(start.toISOString(), "2026-07-27T18:00:00.000Z");
});

test("a task added to another day follows the last task, and an empty day uses the fallback", () => {
  const fallback = new Date("2026-07-28T16:00:00.000Z");
  assert.equal(nextTaskStart(tasks, fallback).toISOString(), "2026-07-27T18:00:00.000Z");
  assert.equal(nextTaskStart([], fallback).toISOString(), "2026-07-28T16:00:00.000Z");
});

test("finds idle gaps between tasks", () => {
  assert.deepEqual(gapStarts(gappedTasks), [
    null,
    null,
    new Date("2026-07-27T21:00:00.000Z").getTime(),
    null,
  ]);
});

test("rescheduling keeps a late task where it is instead of pulling it into the past", () => {
  const scheduled = rescheduleTasks(gappedTasks, gappedTasks[0].startAt, gapStarts(gappedTasks));
  assert.deepEqual(
    scheduled.map((task) => [task.id, task.startAt]),
    gappedTasks.map((task) => [task.id, task.startAt]),
  );
});

test("a longer early task pushes later tasks only once it reaches them", () => {
  const edited = gappedTasks.map((task) =>
    task.id === "security" ? { ...task, minutes: 400 } : task,
  );
  const scheduled = rescheduleTasks(edited, edited[0].startAt, gapStarts(gappedTasks));

  assert.deepEqual(
    scheduled.map((task) => [task.id, task.startAt]),
    [
      ["security", "2026-07-27T15:00:00.000Z"],
      ["email", "2026-07-27T21:40:00.000Z"],
      ["late", "2026-07-27T22:10:00.000Z"],
      ["wrap", "2026-07-27T22:55:00.000Z"],
    ],
  );
});

test("reordering tasks after a gap leaves the gap in place", () => {
  const reordered = reorderTasks(gappedTasks, "wrap", "late", "before");
  const anchor = reorderAnchor(gappedTasks, "wrap", reordered);
  const scheduled = rescheduleTasks(reordered, anchor, gapStarts(gappedTasks));

  assert.deepEqual(
    scheduled.map((task) => [task.id, task.startAt]),
    [
      ["security", "2026-07-27T15:00:00.000Z"],
      ["email", "2026-07-27T16:00:00.000Z"],
      ["wrap", "2026-07-27T21:00:00.000Z"],
      ["late", "2026-07-27T21:15:00.000Z"],
    ],
  );
});

test("deleting the task right after a gap hands the gap to the next task", () => {
  const gaps = gapStartsAfterRemoval(gapStarts(gappedTasks), 2);
  const remaining = gappedTasks.filter((task) => task.id !== "late");
  const scheduled = rescheduleTasks(remaining, remaining[0].startAt, gaps);

  assert.deepEqual(
    scheduled.map((task) => [task.id, task.startAt]),
    [
      ["security", "2026-07-27T15:00:00.000Z"],
      ["email", "2026-07-27T16:00:00.000Z"],
      ["wrap", "2026-07-27T21:00:00.000Z"],
    ],
  );
});

test("deleting a task before a gap moves up only the tasks touching it", () => {
  const gaps = gapStartsAfterRemoval(gapStarts(gappedTasks), 0);
  const remaining = gappedTasks.filter((task) => task.id !== "security");
  const scheduled = rescheduleTasks(remaining, remaining[0].startAt, gaps);

  assert.deepEqual(
    scheduled.map((task) => [task.id, task.startAt]),
    [
      ["email", "2026-07-27T16:00:00.000Z"],
      ["late", "2026-07-27T21:00:00.000Z"],
      ["wrap", "2026-07-27T21:45:00.000Z"],
    ],
  );
});
