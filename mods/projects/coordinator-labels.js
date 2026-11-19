// Names a coordinator shares with bin/hb_coordinator.py, bin/herdr-ask and the Pi.
export const COORDINATOR_TITLE = "Coordinator";
// On the coordinator's terminal: its project. On a worker's: the project whose coordinator handles it.
export const COORDINATOR_LABEL = "herdr.coordinator";
export const COORDINATED_LABEL = "herdr.coordinated";
// hb ask sets both; the person's next prompt in that terminal clears them.
export const ASK_LABEL = "herdr.coordinator.ask";
export const ASKED_LABEL = "herdr.coordinator.asked";
// Every message the board sends a coordinator starts with this, so herdr-ask tells it from the person's.
export const BOARD_PREFIX = "[board]";
