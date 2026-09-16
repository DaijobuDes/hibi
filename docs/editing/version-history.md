# version history

open **version history** from the command palette. every successful save keeps a local snapshot, independent of git. select a timestamp to preview its markdown, then choose **restore to editor**. unsaved work uses the normal save/discard/cancel prompt. restoring changes the buffer only; save when ready to replace the file. external-change checks still apply.

history lives in hibi's private application data, never in the workspace or exported documentation. consecutive identical versions are deduplicated. each file keeps up to 100 snapshots and 20 mib, retaining at least its latest snapshot. the original disk content is also recorded when first saving changes to an existing file, including an external version explicitly replaced by the user.

history is indexed by canonical file path. save-as starts the destination's history. an unsaved document has no saved versions. previews cannot execute markdown or html. if saving succeeds but history storage fails, hibi reports that distinction.
