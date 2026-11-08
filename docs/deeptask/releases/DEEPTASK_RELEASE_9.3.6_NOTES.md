# Deeptask 9.3.6

## Isolate live command chrome

`commandExecutionStatus` used to bypass `shouldBroadcastTaskToChat` and paint Continue/Terminate over the focused conversation. 9.3.6 closes that hole:

- Host drops unscoped or background events via `shouldBroadcastCommandExecutionToChat`.
- Missing `taskId` is fail-closed: the host cannot prove the focused chat owns the event.
- The webview also fail-closes when the focused task id is known. A new task not yet in history still trusts the host.

Background shells must not replace the focused chat's Cancel with Continue/Terminate.

## Re-project in-place streaming updates

9.3.5 compact-projected appends, but same-ts `messageUpdated` replaces still swapped full image blobs back onto already-stripped rows inside the 800-row window. The projector now re-runs on in-place replaces (Scientist field: webview V8 3885/4096MB with resident ≈803 and tombstonedCount 1521).

## Omit unchanged same-ts images from incremental IPC

Fingerprint by length plus prefix/suffix; never hash the full base64. The webview merges omitted images back onto the resident row before projecting, so `JSON.parse` does not re-inflate the blob. Storage and model I/O stay full.

Falsification condition: a background conversation running a command still paints Continue/Terminate over the focused Cancel, or a same-ts streaming update inside the 800-row window still re-inflates a previously stripped image blob.

**Full Changelog**: https://github.com/kurzcraft/DeepTask/compare/v9.3.5...v9.3.6
