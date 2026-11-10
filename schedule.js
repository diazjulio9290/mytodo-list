function idOf(task) {
  return String(task.id);
}

function startOf(task) {
  return task.startAt || task.start_at;
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

export function reorderAnchor(tasks, movedTaskId, reorderedTasks) {
  if (tasks.length === 0 || reorderedTasks.length === 0) return null;

  const originalFirst = tasks[0];
  const movedFirstTask =
    idOf(originalFirst) === String(movedTaskId) &&
    idOf(reorderedTasks[0]) !== idOf(originalFirst);

  return startOf(movedFirstTask ? reorderedTasks[0] : originalFirst);
}

function endOf(task) {
  return task.endAt || task.end_at;
}

// A "gap" is idle time before a task: it starts later than the task before it ends.
// Returns one entry per position: the gap task's start time in ms, or null.
export function gapStarts(tasks) {
  return tasks.map((task, index) => {
    if (index === 0) return null;
    const start = new Date(startOf(task)).getTime();
    const previousEnd = new Date(endOf(tasks[index - 1])).getTime();
    return start - previousEnd >= 1000 ? start : null;
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

// Where a newly added task should start. Pass `now` only when the day is today,
// so a task added after the last one already ended starts now, not in the past.
export function nextTaskStart(tasks, fallbackStart, now = null) {
  const lastTask = tasks.at(-1);
  if (!lastTask) return new Date(fallbackStart);

  const lastEnd = new Date(endOf(lastTask));
  if (now && lastEnd.getTime() < new Date(now).getTime()) return new Date(now);
  return lastEnd;
}

export function rescheduleTasks(tasks, anchorStart, gaps = []) {
  const anchor = new Date(anchorStart);
  if (Number.isNaN(anchor.getTime())) {
    throw new Error("A valid schedule start time is required.");
  }

  let nextStart = anchor.getTime();

  return tasks.map((task, index) => {
    const minutes = Number(task.minutes ?? task.duration_minutes);
    if (!Number.isFinite(minutes) || minutes <= 0) {
      throw new Error("Every task needs a positive duration.");
    }

    // Keep idle time where it was: a position that had a gap never starts earlier than before.
    const gapStart = index > 0 ? gaps[index] : null;
    if (gapStart != null) nextStart = Math.max(nextStart, gapStart);

    const startAt = new Date(nextStart).toISOString();
    const endAt = new Date(nextStart + minutes * 60 * 1000).toISOString();
    nextStart = new Date(endAt).getTime();

    return {
      ...task,
      start_at: startAt,
      end_at: endAt,
      startAt,
      endAt,
      sort_order: index,
    };
  });
}
