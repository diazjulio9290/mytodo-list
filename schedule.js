// Scheduling rules shared by the page and the server.
//
// Three kinds of task:
// - "next in line": starts when the task before it ends.
// - "set time": has a scheduled_at time and never starts before it.
// - "waiting": added to the list but not started yet. It takes no time on
//   the clock until the plan is started (see startPlan).

function idOf(task) {
  return String(task.id);
}

function startOf(task) {
  return task.startAt || task.start_at;
}

function endOf(task) {
  return task.endAt || task.end_at;
}

function toMs(value) {
  return new Date(value).getTime();
}

function isWaiting(task) {
  return Boolean(task.waiting);
}

// The set time of a task in ms, or null when it is "next in line".
function scheduledOf(task) {
  const value = task.scheduledAt ?? task.scheduled_at;
  return value == null ? null : toMs(value);
}

function durationOf(task) {
  const minutes = Number(task.minutes ?? task.duration_minutes);
  if (!Number.isFinite(minutes) || minutes <= 0) {
    throw new Error("Every task needs a positive duration.");
  }
  return minutes * 60 * 1000;
}

function withTimes(task, startMs, endMs, extra = {}) {
  const startAt = new Date(startMs).toISOString();
  const endAt = new Date(endMs).toISOString();
  return { ...task, start_at: startAt, end_at: endAt, startAt, endAt, ...extra };
}

export function reorderTasks(tasks, movedTaskId, targetTaskId, position = "before") {
  const movedId = String(movedTaskId);
  const targetId = String(targetTaskId);

  if (movedId === targetId) return [...tasks];
  if (position !== "before" && position !== "after") {
    throw new Error('Position must be either "before" or "after".');
  }

  const reordered = [...tasks];
  const movedIndex = reordered.findIndex((task) => idOf(task) === movedId);
  if (movedIndex < 0) throw new Error("The task being moved was not found.");

  const [movedTask] = reordered.splice(movedIndex, 1);
  const targetIndex = reordered.findIndex((task) => idOf(task) === targetId);
  if (targetIndex < 0) throw new Error("The destination task was not found.");

  const insertionIndex = position === "after" ? targetIndex + 1 : targetIndex;
  reordered.splice(insertionIndex, 0, movedTask);
  return reordered;
}

// The time the plan is measured from: the start of the first task that is on the clock.
export function planAnchor(tasks) {
  const first = tasks.find((task) => !isWaiting(task)) ?? tasks[0];
  return first ? startOf(first) : null;
}

export function reorderAnchor(tasks, movedTaskId, reorderedTasks) {
  if (tasks.length === 0 || reorderedTasks.length === 0) return null;

  const original = tasks.filter((task) => !isWaiting(task));
  const reordered = reorderedTasks.filter((task) => !isWaiting(task));
  if (original.length === 0) return startOf(tasks[0]);

  const originalFirst = original[0];
  const movedFirstTask =
    idOf(originalFirst) === String(movedTaskId) &&
    idOf(reordered[0]) !== idOf(originalFirst);

  return startOf(movedFirstTask ? reordered[0] : originalFirst);
}

// A "gap" is idle time before a task: it starts later than the task before it ends.
// Returns one entry per position: the gap task's start time in ms, or null.
// Waiting tasks are skipped, because they are not on the clock.
export function gapStarts(tasks) {
  let previousEnd = null;

  return tasks.map((task) => {
    if (isWaiting(task)) return null;

    const start = toMs(startOf(task));
    const gap = previousEnd !== null && start - previousEnd >= 1000 ? start : null;
    previousEnd = toMs(endOf(task));
    return gap;
  });
}

// When a task is removed, the task after it takes over its gap (if it had one).
export function gapStartsAfterRemoval(gaps, removedIndex) {
  const next = [...gaps];
  const [removedGap] = next.splice(removedIndex, 1);
  if (removedIndex > 0 && removedIndex < next.length && next[removedIndex] === null) {
    next[removedIndex] = removedGap ?? null;
  }
  if (next.length > 0) next[0] = null;
  return next;
}

// When a task is inserted, it gets no gap of its own and later positions shift down.
export function gapStartsAfterInsert(gaps, insertedIndex) {
  const next = [...gaps];
  next.splice(insertedIndex, 0, null);
  return next;
}

// Where a newly added "next in line" task should start. Pass `now` only when the
// day is today, so a task added after the last one already ended starts now.
export function nextTaskStart(tasks, fallbackStart, now = null) {
  const lastTask = tasks.filter((task) => !isWaiting(task)).at(-1);
  if (!lastTask) return new Date(fallbackStart);

  const lastEnd = new Date(endOf(lastTask));
  if (now && lastEnd.getTime() < new Date(now).getTime()) return new Date(now);
  return lastEnd;
}

// Where a new set-time task belongs in a list that is in time order.
// It goes before the first task that starts at or after its time. It also goes
// before a task that would still be running at that time, as long as that task
// has not started yet and has no set time of its own.
export function scheduledInsertIndex(tasks, scheduledAt, now) {
  const at = toMs(scheduledAt);
  const current = toMs(now);

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index];
    if (isWaiting(task)) continue;

    const start = toMs(startOf(task));
    if (start >= at) return index;

    const stillRunning = toMs(endOf(task)) > at;
    const canMove = start > current && scheduledOf(task) === null;
    if (stillRunning && canMove) return index;
  }

  return tasks.length;
}

export function rescheduleTasks(tasks, anchorStart, gaps = []) {
  const anchor = new Date(anchorStart);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("A valid schedule start time is required.");
  }

  let nextStart = anchor.getTime();
  let placedOne = false;

  return tasks.map((task, index) => {
    const duration = durationOf(task);

    // A waiting task only keeps its place in the list. It does not push the clock.
    if (isWaiting(task)) {
      return withTimes(task, nextStart, nextStart + duration, { sort_order: index });
    }

    // Keep idle time where it was: a position that had a gap never starts earlier than before.
    const gapStart = placedOne ? gaps[index] : null;
    if (gapStart != null) nextStart = Math.max(nextStart, gapStart);

    // A set-time task never starts before its time.
    const scheduled = scheduledOf(task);
    if (scheduled !== null) nextStart = Math.max(nextStart, scheduled);

    const start = nextStart;
    nextStart = start + duration;
    placedOne = true;
    return withTimes(task, start, nextStart, { sort_order: index });
  });
}

// Start the waiting tasks at `startAt`.
// - Tasks already on the clock that began by then stay as they are.
// - Waiting tasks run in list order from `startAt` (or once a running task ends).
// - Tasks that hold a time (a set time, or one already planned for later) keep it.
//   A waiting task that would run into one of them goes after it instead.
// Returns every task, in time order, none of them waiting.
export function startPlan(tasks, startAt) {
  const begin = toMs(startAt);
  if (Number.isNaN(begin)) {
    throw new Error("A valid start time is required.");
  }

  const begun = tasks.filter((task) => !isWaiting(task) && toMs(startOf(task)) <= begin);
  const rest = tasks.filter((task) => isWaiting(task) || toMs(startOf(task)) > begin);

  const heldTime = (task) => scheduledOf(task) ?? toMs(startOf(task));
  const held = rest
    .filter((task) => !isWaiting(task))
    .sort((a, b) => heldTime(a) - heldTime(b));
  const flowing = rest.filter((task) => isWaiting(task));

  let clock = Math.max(begin, ...begun.map((task) => toMs(endOf(task))));
  const placed = [];
  const place = (task, earliest = clock) => {
    const start = Math.max(clock, earliest);
    clock = start + durationOf(task);
    placed.push(withTimes(task, start, clock, { waiting: false }));
  };

  let next = 0;
  for (const task of flowing) {
    while (next < held.length && heldTime(held[next]) < clock + durationOf(task)) {
      place(held[next], heldTime(held[next]));
      next += 1;
    }
    place(task, scheduledOf(task) ?? clock);
  }
  for (; next < held.length; next += 1) {
    place(held[next], heldTime(held[next]));
  }

  return [...begun, ...placed].map((task, index) => ({ ...task, sort_order: index }));
}
