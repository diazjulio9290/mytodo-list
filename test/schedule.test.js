import test from "node:test";
import assert from "node:assert/strict";

import {
  gapStarts,
  gapStartsAfterInsert,
  gapStartsAfterRemoval,
  nextTaskStart,
  planAnchor,
  reorderAnchor,
  reorderTasks,
  rescheduleTasks,
  scheduledInsertIndex,
  startPlan,
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

// ---- Waiting tasks, set-time tasks and starting the plan ----

const at = (time) => `2026-07-27T${time}:00.000Z`;
const times = (list) => list.map((task) => [task.id, task.startAt.slice(11, 16), task.endAt.slice(11, 16)]);
const waitingTask = (id, minutes) => ({
  id,
  minutes,
  waiting: true,
  startAt: at("15:00"),
  endAt: at("15:00"),
});
const clockTask = (id, start, end, extra = {}) => ({
  id,
  minutes: (new Date(at(end)) - new Date(at(start))) / 60000,
  startAt: at(start),
  endAt: at(end),
  ...extra,
});

test("starting a waiting list runs the tasks in order from the start time", () => {
  const list = [waitingTask("a", 30), waitingTask("b", 45), waitingTask("c", 15)];
  const started = startPlan(list, at("16:10"));

  assert.deepEqual(times(started), [
    ["a", "16:10", "16:40"],
    ["b", "16:40", "17:25"],
    ["c", "17:25", "17:40"],
  ]);
  assert.ok(started.every((task) => task.waiting === false));
  assert.deepEqual(started.map((task) => task.sort_order), [0, 1, 2]);
});

test("starting leaves earlier tasks alone and waits for one that is still running", () => {
  const list = [
    clockTask("done", "13:00", "14:00"),
    clockTask("running", "15:30", "16:30"),
    waitingTask("a", 30),
  ];
  const started = startPlan(list, at("16:00"));

  assert.deepEqual(times(started), [
    ["done", "13:00", "14:00"],
    ["running", "15:30", "16:30"],
    ["a", "16:30", "17:00"],
  ]);
});

test("starting keeps a set-time task on time and moves a task that would run into it", () => {
  const list = [
    waitingTask("a", 30),
    waitingTask("b", 60),
    waitingTask("c", 20),
    clockTask("dentist", "18:00", "19:00", { scheduledAt: at("18:00") }),
  ];
  const started = startPlan(list, at("16:45"));

  // a fits before 18:00. b would run until 18:15, so the dentist goes first.
  assert.deepEqual(times(started), [
    ["a", "16:45", "17:15"],
    ["dentist", "18:00", "19:00"],
    ["b", "19:00", "20:00"],
    ["c", "20:00", "20:20"],
  ]);
});

test("a waiting task does not push tasks that are on the clock", () => {
  const list = [
    clockTask("first", "15:00", "16:00"),
    waitingTask("later", 90),
    clockTask("second", "16:00", "16:30"),
  ];
  const scheduled = rescheduleTasks(list, list[0].startAt, gapStarts(list));

  assert.deepEqual(gapStarts(list), [null, null, null]);
  assert.equal(scheduled[0].startAt, at("15:00"));
  assert.equal(scheduled[2].startAt, at("16:00"));
  assert.equal(scheduled[1].waiting, true);
  assert.deepEqual(scheduled.map((task) => task.sort_order), [0, 1, 2]);
});

test("the plan is measured from the first task on the clock", () => {
  const list = [waitingTask("w", 30), clockTask("real", "17:00", "17:30")];
  assert.equal(planAnchor(list), at("17:00"));
  assert.equal(planAnchor([waitingTask("w", 30)]), at("15:00"));
  assert.equal(planAnchor([]), null);
  assert.equal(reorderAnchor(list, "w", [list[1], list[0]]), at("17:00"));
});

test("a next in line task ignores waiting tasks when working out its start", () => {
  const list = [clockTask("real", "17:00", "17:30"), waitingTask("w", 30)];
  assert.equal(nextTaskStart(list, at("09:00")).toISOString(), at("17:30"));
  assert.equal(nextTaskStart([waitingTask("w", 30)], at("09:00")).toISOString(), at("09:00"));
});

test("a set-time task never starts before its time", () => {
  const list = [
    clockTask("a", "15:00", "15:30"),
    clockTask("meeting", "17:00", "17:30", { scheduledAt: at("17:00") }),
    clockTask("b", "17:30", "18:00"),
  ];
  // Even with no remembered gaps, the meeting holds its time.
  const scheduled = rescheduleTasks(list, list[0].startAt, []);

  assert.deepEqual(times(scheduled), [
    ["a", "15:00", "15:30"],
    ["meeting", "17:00", "17:30"],
    ["b", "17:30", "18:00"],
  ]);
});

test("a set-time task starts late when the task before it runs over, and keeps its time when dragged", () => {
  const list = [
    clockTask("a", "15:00", "15:30"),
    clockTask("meeting", "17:00", "17:30", { scheduledAt: at("17:00") }),
  ];
  const longer = [{ ...list[0], minutes: 150 }, list[1]];
  assert.deepEqual(times(rescheduleTasks(longer, at("15:00"), gapStarts(list))), [
    ["a", "15:00", "17:30"],
    ["meeting", "17:30", "18:00"],
  ]);

  const dragged = reorderTasks(list, "meeting", "a", "before");
  assert.deepEqual(times(rescheduleTasks(dragged, reorderAnchor(list, "meeting", dragged), gapStarts(list))), [
    ["meeting", "17:00", "17:30"],
    ["a", "17:30", "18:00"],
  ]);
});

test("a new set-time task is placed in time order", () => {
  const list = [
    clockTask("a", "15:00", "16:00"),
    clockTask("b", "16:00", "17:00"),
    clockTask("c", "17:00", "18:00"),
  ];
  const now = at("15:10");

  // exactly at a boundary: before the task that starts then
  assert.equal(scheduledInsertIndex(list, at("17:00"), now), 2);
  // in the middle of a task that has not started: before it, so it stays on time
  assert.equal(scheduledInsertIndex(list, at("16:30"), now), 1);
  // in the middle of the task that is running now: after it
  assert.equal(scheduledInsertIndex(list, at("15:30"), now), 1);
  // after everything
  assert.equal(scheduledInsertIndex(list, at("19:00"), now), 3);
  // before everything on another day
  assert.equal(scheduledInsertIndex(list, at("14:00"), at("10:00")), 0);
});

test("a new set-time task does not jump ahead of another set-time task it overlaps", () => {
  const list = [
    clockTask("a", "15:00", "16:00"),
    clockTask("meeting", "16:00", "17:00", { scheduledAt: at("16:00") }),
  ];
  assert.equal(scheduledInsertIndex(list, at("16:30"), at("15:10")), 2);
});

test("adding a set-time task into a busy stretch keeps it on time and moves the rest after it", () => {
  const list = [
    clockTask("a", "15:00", "16:00"),
    clockTask("b", "16:00", "17:00"),
    clockTask("c", "17:00", "18:00"),
  ];
  const index = scheduledInsertIndex(list, at("16:30"), at("15:10"));
  const added = clockTask("call", "16:30", "16:50", { scheduledAt: at("16:30") });
  const next = [...list];
  next.splice(index, 0, added);
  const scheduled = rescheduleTasks(next, next[0].startAt, gapStartsAfterInsert(gapStarts(list), index));

  assert.deepEqual(times(scheduled), [
    ["a", "15:00", "16:00"],
    ["call", "16:30", "16:50"],
    ["b", "16:50", "17:50"],
    ["c", "17:50", "18:50"],
  ]);
});
