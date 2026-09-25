# Git Checkout Main, Merge, Push and Branch with Version Number

Switch to main branch, merge the previous branch into main, push to remote, then create a new branch with automatic version naming.

## Steps

1. Remember the current branch name (let's call it `previous-branch`)
2. Run `git checkout main` to switch to main branch
3. Run `git merge previous-branch` to merge the previous branch into main
4. Run `git push origin main` to push the merged changes to remote
5. Find the current version number from package.json, VERSION file, or git tags
6. Increment the version number (patch, minor, or major based on $ARGUMENTS, default to patch)
7. Run `git checkout -b release/v<new-version>` to create and switch to the new version branch
