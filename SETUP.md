# R093 Revision Hub — Setup Guide

A self-hosted Cambridge Nationals R093 revision site for Ralph Thoresby School. Students log in, complete tasks, and the teacher tracks progress and sets homework. Data is stored in a Google Sheet via a Google Apps Script Web App.

This guide walks through the one-time setup. Allow about 15–20 minutes.

---

## What you'll end up with

- **Google Sheet** holding all the data (users, classes, scores, written answers, etc.).
- **Apps Script Web App** that the website talks to as an API.
- **`index.html`** that you can open directly, share via OneDrive/Google Drive, or host on GitHub Pages.

---

## Step 1 — Create the Google Sheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new blank spreadsheet.
2. Rename it something clear, e.g. `R093 Revision Hub Data`.
3. Leave the first tab as it is — the script will create the tabs it needs automatically.

---

## Step 2 — Add the Apps Script

1. With the sheet open, click **Extensions → Apps Script**.
2. A new tab opens with a blank `Code.gs` file. Delete anything inside.
3. Open `Code.gs` from this folder, copy everything, and paste it in.
4. Click the **disk icon** (Save). Give the project a name like `R093 Hub API`.
5. (Recommended) In the Apps Script editor, select the function `setupSheets` from the dropdown next to the Run button, then click **Run**. The first time it will ask for permission — review and accept. This creates all the data tabs (`Users`, `Classes`, `Quizzes`, `WrittenAnswers`, `Flashcards`, `Mocks`, `Assignments`) with headers.

---

## Step 3 — Deploy as a Web App

1. In the Apps Script editor, click **Deploy → New deployment**.
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Fill in:
   - **Description:** `R093 Hub API v1`
   - **Execute as:** `Me (your-email@…)`
   - **Who has access:** `Anyone`
4. Click **Deploy**. You may be asked to authorise — review and allow.
5. Copy the **Web app URL** that appears. It will look like:
   ```
   https://script.google.com/macros/s/AKfycb…long…id…/exec
   ```

> **Why "Anyone" access?** The script itself controls who can read what — students need their email + password to log in. The URL just lets the front-end reach the script without requiring every student to authenticate to Google first.

---

## Step 4 — Plug the URL into the website

1. Open `index.html` in a text editor.
2. Near the top of the `<script>` block, find:
   ```js
   const SCRIPT_URL = ""; // e.g. "https://script.google.com/macros/s/AKfycb.../exec"
   ```
3. Paste your Web App URL between the quotes:
   ```js
   const SCRIPT_URL = "https://script.google.com/macros/s/AKfycb.../exec";
   ```
4. Save the file.

---

## Step 5 — Try it

1. Double-click `index.html` to open it in your browser (or host it — see "Hosting options" below).
2. Click **Register**, choose role **Teacher**, and create your account with your school email.
3. Sign in. From the **Classes** tab, click **+ New class** and create one (e.g. `10X iMedia`).
4. Open the site again (e.g. in a private window), register a test student account, then in the teacher view click **Add student** on the class and enter that student's email.
5. As the student, complete a quiz. Switch back to the teacher view — the student's score should appear under **Progress**.

---

## Hosting options

- **Easiest:** keep `index.html` somewhere shared (OneDrive / SharePoint / Google Drive) and give students the link to download or open it.
- **Recommended for a class of students:** host it on **GitHub Pages** (the same way Teall Maths is hosted). Drop `index.html` into a public GitHub repo, enable GitHub Pages on the `main` branch, and you'll get a `https://yourname.github.io/repo-name/` link students can use anywhere.
- **Local-only test:** double-click `index.html` to open from your Mac. Login still works because the API request goes out to Google.

---

## Updating questions and content

All quiz questions, written exam questions, flashcards and the mock paper are stored as JavaScript constants near the top of `index.html`:

- `QUIZZES` — topic quizzes (5 per topic area).
- `WRITTEN` — exam-style written questions students submit for marking.
- `FLASHCARDS` — keyword flashcards.
- `MOCK` — the timed mock paper (15 questions).

Edit those arrays and save the file. If you're hosting on GitHub Pages, push the change and it goes live automatically.

---

## Adding new task types or extending the dashboard

The front-end calls the Apps Script via a small `api(action, payload)` helper. The script routes by `action` name (`login`, `submitQuiz`, etc.). To add a new endpoint:

1. Add a new function inside the `ACTIONS` object in `Code.gs`.
2. Redeploy — **Deploy → Manage deployments → Edit → New version → Deploy**. Note that you do **not** need to change the URL.
3. Call it from the front-end: `await api("yourNewAction", { … })`.

---

## Security notes (important to read)

- Passwords are stored as **SHA-256 hashes**, not plain text. This is fine for low-stakes classroom use but is **not** suitable for storing sensitive data.
- The Web App URL is effectively a public API. Don't put any genuinely sensitive data (e.g. SEND notes, personal addresses) into the sheet.
- Students see only their own data; teachers see only their own classes' data — but anyone with the script URL who knows valid credentials can call it. Treat it like a school-internal tool.
- For full GDPR-grade student data, use a school-managed system (e.g. Microsoft 365 + SharePoint with proper access controls). This site is fine for revision/homework workflows.

---

## Troubleshooting

**"SCRIPT_URL not configured" banner**
You haven't pasted the Web App URL into `index.html` yet. Go back to Step 4.

**Login button just spins forever**
The Web App URL is wrong, the deployment isn't set to "Anyone" access, or the script has an error. Open the Apps Script editor, click **Executions** in the sidebar, and look at the most recent run's log.

**"No registered student with that email" when adding a student**
The student must register an account first. They sign in at the same URL and choose **Register → Student**.

**A student says they can't see their homework**
Check they're registered with the exact email you added to the class (case-insensitive but otherwise matching).

**I want to wipe everything and start over**
Open the sheet, delete the rows under each tab (keep the header row), and you're back to a blank slate. To reset only one student, delete their row from `Users` plus any rows in `Quizzes` / `WrittenAnswers` / `Flashcards` / `Mocks` matching their email.

---

## What's where in the codebase

```
R093-Revision/
├── index.html      ← The whole front-end (UI + R093 content + state).
├── Code.gs         ← Google Apps Script backend.
└── SETUP.md        ← This file.
```

Single-page app, no build step, no dependencies. Edit, save, refresh.
