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

export function rescheduleTasks(tasks, anchorStart) {
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
