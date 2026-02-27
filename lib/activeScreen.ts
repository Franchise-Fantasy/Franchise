/** Simple module-level flag so the notification handler can suppress alerts
 *  when the user is already viewing the relevant screen. */

let _draftRoomOpen = false;

export function setDraftRoomOpen(open: boolean) {
  _draftRoomOpen = open;
}

export function isDraftRoomOpen() {
  return _draftRoomOpen;
}
