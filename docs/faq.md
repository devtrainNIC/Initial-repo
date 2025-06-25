# Frequently Asked Questions (FAQ)

This FAQ addresses common questions that come up during GitHub for Developers training.

## 🔄 Git & GitHub Basics

### Q: What's the difference between Git and GitHub?
**A:** Git is the version control system that runs locally on your computer. GitHub is a cloud-based platform that hosts Git repositories and provides additional collaboration features like Pull Requests, Issues, and project management tools.

### Q: What is a repository?
**A:** A repository (or "repo") is a folder/directory that contains your project files and the complete history of all changes made to those files. It's where Git stores all the version information.

### Q: What's the difference between a branch and a fork?
**A:** 
- **Branch**: A parallel version of your code within the same repository
- **Fork**: A complete copy of someone else's repository under your account

## 🌳 Branching & Merging

### Q: When should I create a new branch?
**A:** Create a new branch for each feature, bug fix, or experiment. This keeps your main branch stable and allows you to work on multiple things simultaneously.

### Q: How do I switch between branches?
**A:** Use `git checkout branch-name` or `git switch branch-name` (Git 2.23+)

### Q: What if I forgot to create a branch and made changes on main?
**A:** Don't panic! You can create a new branch and move your changes:
```bash
git checkout -b new-feature-branch
git add .
git commit -m "Your commit message"
```

## 🔀 Pull Requests

### Q: When should I create a Pull Request?
**A:** Create a Pull Request when your feature or fix is ready for review, even if it's not completely finished. You can always add more commits to the same branch.

### Q: Can I make changes after creating a Pull Request?
**A:** Yes! Any commits you push to the branch will automatically appear in the Pull Request.

### Q: Who should review my Pull Request?
**A:** For training activities, ask a classmate or tag the instructors (@Parul-mahajan, @mpranshu).

## ⚔️ Merge Conflicts

### Q: What causes merge conflicts?
**A:** Merge conflicts happen when Git can't automatically merge changes because the same lines were modified in different ways on different branches.

### Q: How do I resolve a merge conflict?
**A:** 
1. Open the conflicted file(s)
2. Look for conflict markers (`<<<<<<<`, `=======`, `>>>>>>>`)
3. Decide which changes to keep
4. Remove the conflict markers
5. Save the file
6. Add and commit the resolved file

### Q: How can I avoid merge conflicts?
**A:** 
- Keep branches short-lived
- Pull changes from main regularly
- Communicate with your team about what files you're working on

## 🛠️ Common Commands

### Q: How do I undo my last commit?
**A:** 
- To undo but keep changes: `git reset --soft HEAD~1`
- To undo and discard changes: `git reset --hard HEAD~1`
- To create a new commit that undoes the last one: `git revert HEAD`

### Q: How do I see what changes I've made?
**A:** 
- `git status` - shows which files are modified
- `git diff` - shows the actual changes
- `git log` - shows commit history

### Q: How do I check which branch I'm on?
**A:** `git branch` or `git status`

## 🚨 Troubleshooting

### Q: I get "Permission denied" when pushing
**A:** Check:
1. Are you pushing to the right repository?
2. Do you have write access to the repository?
3. Are your Git credentials set up correctly?

### Q: My changes aren't showing up in the Pull Request
**A:** Make sure you:
1. Committed your changes (`git commit`)
2. Pushed to the right branch (`git push origin branch-name`)
3. Are looking at the correct Pull Request

### Q: I can't see other people's changes
**A:** Pull the latest changes from the main branch:
```bash
git checkout main
git pull origin main
```

### Q: I accidentally committed to the wrong branch
**A:** You can move commits to another branch:
```bash
git log --oneline  # find the commit hash
git checkout correct-branch
git cherry-pick <commit-hash>
git checkout wrong-branch
git reset --hard HEAD~1  # remove from wrong branch
```

## 📚 Learning Resources

### Q: Where can I practice Git commands safely?
**A:** 
- [Learn Git Branching](https://learngitbranching.js.org/) - Interactive tutorial
- [Git Katas](https://github.com/praqma-training/gitkatas) - Practice exercises
- Create a test repository to experiment

### Q: What are some good resources for learning more?
**A:** Check the [Class Resources](../README.md#class-resources) section in the README for comprehensive lists of tutorials, videos, and documentation.

---

## 🆘 Still Need Help?

If your question isn't answered here:

1. 📝 **Post in the [Parking Lot](https://github.com/devtrainNIC/Initial-repo/issues/11)** - Use our [question templates](question-templates.md)
2. 🙋 **Ask during class** - Raise your hand or use chat
3. 👥 **Ask a classmate** - They might have faced the same issue
4. 📧 **Contact instructors** - @Parul-mahajan, @mpranshu

Remember: **There are no silly questions!** Everyone learns at their own pace. 🚀