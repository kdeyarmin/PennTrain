# Getting this into your GitHub repo with Claude Code

## 1. Download & unzip
Download the handoff zip from the chat and unzip it somewhere convenient
(e.g. ~/Downloads/design_handoff_marketing_site).

## 2. Open your repo in Claude Code
In a terminal:

    cd path/to/PennTrain
    claude

(If you don't have Claude Code: `npm install -g @anthropic-ai/claude-code`, then run `claude` and sign in.)

## 3. Copy the handoff into the repo

    cp -r ~/Downloads/design_handoff_marketing_site .

## 4. Ask Claude Code to implement and push
Paste this prompt:

    Read design_handoff_marketing_site/README.md. Implement the redesigned
    marketing site in artifacts/caremetric-carebase, replacing the existing
    Landing.tsx and src/pages/marketing/ pages. Recreate the designs
    high-fidelity using our existing MarketingLayout, primitives, router,
    and content.ts patterns. Then create a branch called
    marketing-site-redesign, commit the changes, push it, and open a
    pull request with a summary of the redesign.

Claude Code will implement the pages, run the build, and use `git` + `gh`
to push the branch and open the PR. If it asks for permission to run git
commands, approve them.

## 5. Review the PR
Open the PR on github.com/kdeyarmin/PennTrain, review the preview/build,
and merge when happy.

Tip: if `gh` (GitHub CLI) isn't installed, Claude Code can still commit and
push; you'd then click "Compare & pull request" on github.com yourself.
