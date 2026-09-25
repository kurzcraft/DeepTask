# Git Checkout Main, Merge, Push and Branch

Switch to main branch, merge the previous branch into main, push to remote, then create a new branch.

## Steps

1. Remember the current branch name (let's call it `previous-branch`)
2. Run `git checkout main` to switch to main branch
3. Run `git merge previous-branch` to merge the previous branch into main
4. Run `git push origin main` to push the merged changes to remote
5. Run `git checkout -b $ARGUMENTS` to create and switch to the new branch
