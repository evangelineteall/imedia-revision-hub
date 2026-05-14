/**
 * R093 Revision Hub  —  Google Apps Script backend
 * Ralph Thoresby School
 *
 * Acts as a lightweight JSON API for the R093 Revision Hub front-end.
 * All data is stored in the bound Google Sheet (one tab per data type).
 *
 * Deploy instructions are in SETUP.md.
 *
 * IMPORTANT: deploy as a Web App with:
 *   Execute as: Me
 *   Who has access: Anyone
 * (Apps Script then issues a /exec URL — paste it into index.html as SCRIPT_URL.)
 */

const SHEETS = {
  USERS: "Users",
  CLASSES: "Classes",
  QUIZZES: "Quizzes",
  WRITTEN: "WrittenAnswers",
  FLASHCARDS: "Flashcards",
  MOCKS: "Mocks",
  ASSIGNMENTS: "Assignments",
  DRAWINGS: "Drawings"
};

const HEADERS = {
  Users:           ["email","name","role","passwordHash","lastActive"],
  Classes:         ["id","name","teacherEmail","studentsCsv","sharedWithCsv"],
  Quizzes:         ["timestamp","email","topic","score","total","taskType","details"],
  WrittenAnswers:  ["id","timestamp","email","questionId","answer","mark","feedback","markedBy"],
  Flashcards:      ["timestamp","email","term","status"],
  Mocks:           ["timestamp","email","mockId","score","total","details"],
  Assignments:     ["id","classId","taskType","topic","dueDate","createdBy","createdAt","note","releaseDate"],
  Drawings:        ["id","timestamp","email","drawingId","imageData","mark","feedback","markedBy"]
};

/* ---------- Sheet helpers ---------- */
function getSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    const headers = HEADERS[name];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
      sheet.setFrozenRows(1);
    }
  }
  return sheet;
}

function readAll(name) {
  const sheet = getSheet(name);
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i]);
    return obj;
  });
}

function appendRow(name, obj) {
  const sheet = getSheet(name);
  const headers = HEADERS[name] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : "");
  sheet.appendRow(row);
}

function updateRow(name, matchKey, matchValue, updates) {
  const sheet = getSheet(name);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const keyIdx = headers.indexOf(matchKey);
  if (keyIdx === -1) return false;
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][keyIdx]) === String(matchValue)) {
      Object.keys(updates).forEach(k => {
        const c = headers.indexOf(k);
        if (c !== -1) sheet.getRange(r + 1, c + 1).setValue(updates[k]);
      });
      return true;
    }
  }
  return false;
}

/* ---------- Auth helpers ---------- */
function hashPassword(password) {
  // SHA-256 hex; lightweight, not bcrypt — suitable for low-risk classroom use.
  const raw = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return raw.map(b => ("0" + (b & 0xff).toString(16)).slice(-2)).join("");
}

function findUser(email) {
  return readAll(SHEETS.USERS).find(u => String(u.email).toLowerCase() === String(email).toLowerCase());
}

/* ---------- Routing ---------- */
function doPost(e) {
  let payload = {};
  try {
    payload = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOut({ ok: false, error: "Invalid JSON body." });
  }
  try {
    const action = payload.action;
    const fn = ACTIONS[action];
    if (!fn) return jsonOut({ ok: false, error: "Unknown action: " + action });
    const result = fn(payload);
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

function doGet() {
  return jsonOut({ ok: true, message: "R093 API is live. Use POST." });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/* ---------- Actions ---------- */
const ACTIONS = {

  register({ email, password, name, role }) {
    if (!email || !password || !name) return { ok: false, error: "Missing fields." };
    if (!["student","teacher"].includes(role)) return { ok: false, error: "Invalid role." };
    const existing = findUser(email);
    if (existing) return { ok: false, error: "An account with that email already exists." };
    appendRow(SHEETS.USERS, {
      email: email.toLowerCase(),
      name: name,
      role: role,
      passwordHash: hashPassword(password),
      lastActive: new Date().toISOString()
    });
    return { ok: true };
  },

  login({ email, password }) {
    const u = findUser(email);
    if (!u) return { ok: false, error: "No account with that email." };
    if (u.passwordHash !== hashPassword(password)) return { ok: false, error: "Wrong password." };
    updateRow(SHEETS.USERS, "email", u.email, { lastActive: new Date().toISOString() });
    return { ok: true, user: { email: u.email, name: u.name, role: u.role } };
  },

  submitQuiz({ email, topic, score, total, taskType, details }) {
    appendRow(SHEETS.QUIZZES, {
      timestamp: new Date().toISOString(),
      email: email.toLowerCase(),
      topic, score, total, taskType: taskType || "quiz",
      details: details ? JSON.stringify(details) : ""
    });
    updateRow(SHEETS.USERS, "email", email.toLowerCase(), { lastActive: new Date().toISOString() });
    return { ok: true };
  },

  submitWritten({ email, questionId, answer }) {
    const id = "w_" + new Date().getTime() + "_" + Math.floor(Math.random()*1000);
    // If a previous unmarked submission exists for this question by this student, replace it
    const existing = readAll(SHEETS.WRITTEN).find(r =>
      String(r.email).toLowerCase() === email.toLowerCase() &&
      r.questionId === questionId &&
      (r.mark === "" || r.mark === null || r.mark === undefined)
    );
    if (existing) {
      updateRow(SHEETS.WRITTEN, "id", existing.id, {
        timestamp: new Date().toISOString(),
        answer: answer
      });
      updateRow(SHEETS.USERS, "email", email.toLowerCase(), { lastActive: new Date().toISOString() });
      return { ok: true, id: existing.id };
    }
    appendRow(SHEETS.WRITTEN, {
      id,
      timestamp: new Date().toISOString(),
      email: email.toLowerCase(),
      questionId, answer,
      mark: "", feedback: "", markedBy: ""
    });
    updateRow(SHEETS.USERS, "email", email.toLowerCase(), { lastActive: new Date().toISOString() });
    return { ok: true, id };
  },

  updateFlashcard({ email, term, status }) {
    appendRow(SHEETS.FLASHCARDS, {
      timestamp: new Date().toISOString(),
      email: email.toLowerCase(),
      term, status
    });
    updateRow(SHEETS.USERS, "email", email.toLowerCase(), { lastActive: new Date().toISOString() });
    return { ok: true };
  },

  submitMock({ email, mockId, score, total, details }) {
    appendRow(SHEETS.MOCKS, {
      timestamp: new Date().toISOString(),
      email: email.toLowerCase(),
      mockId, score, total,
      details: details ? JSON.stringify(details) : ""
    });
    updateRow(SHEETS.USERS, "email", email.toLowerCase(), { lastActive: new Date().toISOString() });
    return { ok: true };
  },

  createClass({ teacherEmail, name }) {
    if (!teacherEmail || !name) return { ok: false, error: "Missing fields." };
    const id = "c_" + new Date().getTime();
    appendRow(SHEETS.CLASSES, {
      id, name, teacherEmail: teacherEmail.toLowerCase(), studentsCsv: "", sharedWithCsv: ""
    });
    return { ok: true, id };
  },

  shareClass({ classId, teacherEmail }) {
    if (!classId || !teacherEmail) return { ok: false, error: "Missing class id or teacher email." };
    teacherEmail = String(teacherEmail).toLowerCase();
    const u = findUser(teacherEmail);
    if (!u) return { ok: false, error: "No registered teacher with that email." };
    if (u.role !== "teacher") return { ok: false, error: "That account is not a teacher." };
    const cls = readAll(SHEETS.CLASSES).find(c => c.id === classId);
    if (!cls) return { ok: false, error: "Class not found." };
    if (String(cls.teacherEmail).toLowerCase() === teacherEmail) return { ok: false, error: "That teacher already owns this class." };
    const list = (cls.sharedWithCsv || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
    if (!list.includes(teacherEmail)) list.push(teacherEmail);
    updateRow(SHEETS.CLASSES, "id", classId, { sharedWithCsv: list.join(",") });
    return { ok: true };
  },

  unshareClass({ classId, teacherEmail }) {
    if (!classId || !teacherEmail) return { ok: false, error: "Missing class id or teacher email." };
    teacherEmail = String(teacherEmail).toLowerCase();
    const cls = readAll(SHEETS.CLASSES).find(c => c.id === classId);
    if (!cls) return { ok: false, error: "Class not found." };
    const list = (cls.sharedWithCsv || "").split(",")
      .map(s => s.trim()).filter(Boolean)
      .filter(e => e.toLowerCase() !== teacherEmail);
    updateRow(SHEETS.CLASSES, "id", classId, { sharedWithCsv: list.join(",") });
    return { ok: true };
  },

  addStudent({ classId, studentEmail }) {
    studentEmail = studentEmail.toLowerCase();
    const u = findUser(studentEmail);
    if (!u) return { ok: false, error: "No registered student with that email. Ask them to register first." };
    if (u.role !== "student") return { ok: false, error: "That account is not a student." };
    const cls = readAll(SHEETS.CLASSES).find(c => c.id === classId);
    if (!cls) return { ok: false, error: "Class not found." };
    const list = (cls.studentsCsv || "").split(",").map(s=>s.trim()).filter(Boolean);
    if (!list.includes(studentEmail)) list.push(studentEmail);
    updateRow(SHEETS.CLASSES, "id", classId, { studentsCsv: list.join(",") });
    return { ok: true };
  },

  assignHomework({ classId, taskType, topic, dueDate, createdBy, note, releaseDate }) {
    const id = "a_" + new Date().getTime();
    appendRow(SHEETS.ASSIGNMENTS, {
      id, classId, taskType, topic, dueDate,
      createdBy: createdBy.toLowerCase(),
      createdAt: new Date().toISOString(),
      note: note || "",
      releaseDate: releaseDate || new Date().toISOString().slice(0,10)
    });
    return { ok: true, id };
  },

  deleteAssignment({ id }) {
    if (!id) return { ok: false, error: "Missing assignment id." };
    const sheet = getSheet(SHEETS.ASSIGNMENTS);
    const data = sheet.getDataRange().getValues();
    const headers = data[0];
    const idCol = headers.indexOf("id");
    if (idCol === -1) return { ok: false, error: "id column not found." };
    for (let r = data.length - 1; r >= 1; r--) {
      if (String(data[r][idCol]) === String(id)) {
        sheet.deleteRow(r + 1);
        return { ok: true };
      }
    }
    return { ok: false, error: "Assignment not found." };
  },

  deleteClass({ id }) {
    if (!id) return { ok: false, error: "Missing class id." };
    // Remove the class row
    const classSheet = getSheet(SHEETS.CLASSES);
    const cdata = classSheet.getDataRange().getValues();
    const cheaders = cdata[0];
    const cidCol = cheaders.indexOf("id");
    let removed = false;
    if (cidCol !== -1) {
      for (let r = cdata.length - 1; r >= 1; r--) {
        if (String(cdata[r][cidCol]) === String(id)) {
          classSheet.deleteRow(r + 1);
          removed = true;
          break;
        }
      }
    }
    if (!removed) return { ok: false, error: "Class not found." };
    // Cascade: also delete any assignments tied to this class
    const aSheet = getSheet(SHEETS.ASSIGNMENTS);
    const adata = aSheet.getDataRange().getValues();
    const aheaders = adata[0];
    const aClassCol = aheaders.indexOf("classId");
    if (aClassCol !== -1) {
      for (let r = adata.length - 1; r >= 1; r--) {
        if (String(adata[r][aClassCol]) === String(id)) {
          aSheet.deleteRow(r + 1);
        }
      }
    }
    return { ok: true };
  },

  removeStudentFromClass({ classId, studentEmail }) {
    if (!classId || !studentEmail) return { ok: false, error: "Missing class id or student email." };
    studentEmail = String(studentEmail).toLowerCase();
    const cls = readAll(SHEETS.CLASSES).find(c => c.id === classId);
    if (!cls) return { ok: false, error: "Class not found." };
    const list = (cls.studentsCsv || "").split(",")
      .map(s => s.trim()).filter(Boolean)
      .filter(e => e.toLowerCase() !== studentEmail);
    updateRow(SHEETS.CLASSES, "id", classId, { studentsCsv: list.join(",") });
    return { ok: true };
  },

  submitDrawing({ email, drawingId, imageData }) {
    email = email.toLowerCase();
    // Replace any prior unmarked drawing for the same student/task
    const existing = readAll(SHEETS.DRAWINGS).find(r =>
      String(r.email).toLowerCase() === email &&
      r.drawingId === drawingId &&
      (r.mark === "" || r.mark === null || r.mark === undefined)
    );
    if (existing) {
      updateRow(SHEETS.DRAWINGS, "id", existing.id, {
        timestamp: new Date().toISOString(),
        imageData: imageData
      });
      updateRow(SHEETS.USERS, "email", email, { lastActive: new Date().toISOString() });
      return { ok: true, id: existing.id };
    }
    const id = "d_" + new Date().getTime() + "_" + Math.floor(Math.random()*1000);
    appendRow(SHEETS.DRAWINGS, {
      id,
      timestamp: new Date().toISOString(),
      email,
      drawingId,
      imageData,
      mark: "", feedback: "", markedBy: ""
    });
    updateRow(SHEETS.USERS, "email", email, { lastActive: new Date().toISOString() });
    return { ok: true, id };
  },

  markDrawing({ submissionId, mark, feedback, markedBy }) {
    const ok = updateRow(SHEETS.DRAWINGS, "id", submissionId, {
      mark, feedback: feedback || "",
      markedBy: markedBy ? markedBy.toLowerCase() : ""
    });
    if (!ok) return { ok: false, error: "Submission not found." };
    return { ok: true };
  },

  markWritten({ submissionId, mark, feedback, markedBy }) {
    const ok = updateRow(SHEETS.WRITTEN, "id", submissionId, {
      mark, feedback: feedback || "",
      markedBy: markedBy ? markedBy.toLowerCase() : ""
    });
    if (!ok) return { ok: false, error: "Submission not found." };
    return { ok: true };
  },

  getStudentProgress({ email }) {
    email = email.toLowerCase();
    const parseDetails = s => { try { return s ? JSON.parse(s) : []; } catch(e) { return []; } };
    const quizzes = readAll(SHEETS.QUIZZES).filter(r => String(r.email).toLowerCase() === email)
      .map(r => ({ topic:r.topic, score:Number(r.score), total:Number(r.total), taskType:r.taskType, timestamp:String(r.timestamp), details: parseDetails(r.details) }));
    const written = readAll(SHEETS.WRITTEN).filter(r => String(r.email).toLowerCase() === email)
      .map(r => ({ id:r.id, questionId:r.questionId, answer:r.answer, mark:r.mark, feedback:r.feedback }));
    const mocks = readAll(SHEETS.MOCKS).filter(r => String(r.email).toLowerCase() === email)
      .map(r => ({ mockId:r.mockId, score:Number(r.score), total:Number(r.total), timestamp:String(r.timestamp), details: parseDetails(r.details) }));
    const flashcards = {};
    readAll(SHEETS.FLASHCARDS).filter(r => String(r.email).toLowerCase() === email)
      .forEach(r => { flashcards[r.term] = r.status; });

    const drawings = readAll(SHEETS.DRAWINGS).filter(r => String(r.email).toLowerCase() === email)
      .map(r => ({ id:r.id, drawingId:r.drawingId, imageData:r.imageData, mark:r.mark, feedback:r.feedback, timestamp:String(r.timestamp) }));

    // Find classes the student belongs to
    const classes = readAll(SHEETS.CLASSES).filter(c => (c.studentsCsv||"").split(",").map(s=>s.trim().toLowerCase()).includes(email));
    const classIds = classes.map(c => c.id);
    const assignments = readAll(SHEETS.ASSIGNMENTS).filter(a => classIds.includes(a.classId))
      .map(a => ({ id:a.id, classId:a.classId, taskType:a.taskType, topic:a.topic, dueDate:String(a.dueDate), note: a.note || "", releaseDate: String(a.releaseDate || "") }));

    // Spaced-repetition schedule for flashcards (computed from history)
    const allFlash = readAll(SHEETS.FLASHCARDS).filter(r => String(r.email).toLowerCase() === email);
    const byTerm = {};
    allFlash.forEach(rec => { (byTerm[rec.term] = byTerm[rec.term] || []).push(rec); });
    const flashcardsSched = {};
    const now = new Date().getTime();
    Object.keys(byTerm).forEach(term => {
      const list = byTerm[term].slice().sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
      const last = list[list.length-1];
      let streak = 0;
      for(let i = list.length-1; i >= 0; i--){ if(list[i].status === "mastered") streak++; else break; }
      const lastT = new Date(last.timestamp).getTime();
      let nextReview;
      if(last.status === "again")          nextReview = lastT + 60*1000;
      else if(last.status === "learning")  nextReview = lastT + 24*60*60*1000;
      else { const days = streak <= 1 ? 7 : streak === 2 ? 21 : 60; nextReview = lastT + days * 24*60*60*1000; }
      flashcardsSched[term] = { status: last.status, nextReview, isDue: nextReview <= now, streak };
    });

    return { ok:true, progress: { quizzes, written, mocks, flashcards, flashcardsSched, drawings, assignments } };
  },

  getTeacherData({ email }) {
    email = email.toLowerCase();
    const classes = readAll(SHEETS.CLASSES)
      .filter(c => {
        const owner = String(c.teacherEmail).toLowerCase() === email;
        const shared = (c.sharedWithCsv||"").split(",").map(s=>s.trim().toLowerCase()).filter(Boolean).includes(email);
        return owner || shared;
      })
      .map(c => ({
        id: c.id,
        name: c.name,
        teacherEmail: c.teacherEmail,
        students: (c.studentsCsv||"").split(",").map(s=>s.trim()).filter(Boolean),
        sharedWith: (c.sharedWithCsv||"").split(",").map(s=>s.trim()).filter(Boolean),
        isOwner: String(c.teacherEmail).toLowerCase() === email
      }));
    const allStudentEmails = Array.from(new Set(classes.flatMap(c => c.students)));
    const userIndex = {};
    readAll(SHEETS.USERS).forEach(u => { userIndex[String(u.email).toLowerCase()] = u; });

    const quizRows = readAll(SHEETS.QUIZZES);
    const mockRows = readAll(SHEETS.MOCKS);
    const allProgress = allStudentEmails.map(e => ({
      email: e,
      name: (userIndex[e] && userIndex[e].name) || e,
      lastActive: (userIndex[e] && userIndex[e].lastActive) || "",
      quizzes: quizRows.filter(q => String(q.email).toLowerCase() === e).map(q => ({ topic:q.topic, score:Number(q.score), total:Number(q.total), timestamp:String(q.timestamp), taskType: q.taskType || "quiz", details: (function(s){ try { return s ? JSON.parse(s) : []; } catch(_){ return []; } })(q.details) })),
      mocks: mockRows.filter(m => String(m.email).toLowerCase() === e).map(m => ({ mockId: m.mockId || "MOCK1", score:Number(m.score), total:Number(m.total), timestamp:String(m.timestamp), details: (function(s){ try { return s ? JSON.parse(s) : []; } catch(_){ return []; } })(m.details) }))
    }));

    const pendingMarking = readAll(SHEETS.WRITTEN)
      .filter(r => allStudentEmails.includes(String(r.email).toLowerCase()))
      .filter(r => r.mark === "" || r.mark === null || r.mark === undefined)
      .map(r => ({
        id: r.id,
        studentEmail: r.email,
        studentName: (userIndex[String(r.email).toLowerCase()] && userIndex[String(r.email).toLowerCase()].name) || r.email,
        questionId: r.questionId,
        answer: r.answer,
        timestamp: String(r.timestamp)
      }));

    const pendingDrawings = readAll(SHEETS.DRAWINGS)
      .filter(r => allStudentEmails.includes(String(r.email).toLowerCase()))
      .filter(r => r.mark === "" || r.mark === null || r.mark === undefined)
      .map(r => ({
        id: r.id,
        studentEmail: r.email,
        studentName: (userIndex[String(r.email).toLowerCase()] && userIndex[String(r.email).toLowerCase()].name) || r.email,
        drawingId: r.drawingId,
        imageData: r.imageData,
        timestamp: String(r.timestamp)
      }));

    const classIds = classes.map(c => c.id);
    const assignments = readAll(SHEETS.ASSIGNMENTS).filter(a => classIds.includes(a.classId))
      .map(a => ({ id:a.id, classId:a.classId, taskType:a.taskType, topic:a.topic, dueDate:String(a.dueDate), note: a.note || "", releaseDate: String(a.releaseDate || "") }));

    return { ok:true, data: { classes, allProgress, pendingMarking, pendingDrawings, assignments } };
  }
};

/* ---------- One-time setup helper (optional) ---------- */
/**
 * Run this once from the Apps Script editor (select setupSheets, then Run)
 * to create all required tabs with headers AND seed the initial teacher
 * account. Safe to re-run; it just ensures each sheet exists and won't
 * duplicate the seed account.
 */
function setupSheets() {
  Object.values(SHEETS).forEach(name => getSheet(name));
  seedAdmin();
}

/**
 * Seed the initial teacher account for Evangeline Teall.
 * Idempotent — only adds the row if the email isn't already in Users.
 *
 * Default credentials:
 *   email:    evangeline.teall@ralphthoresby.com
 *   password: Password01
 *
 * Change SEED_ACCOUNTS below to add or alter accounts.
 */
const SEED_ACCOUNTS = [
  { name: "Evangeline Teall",                 email: "evangeline.teall@ralphthoresby.com",         role: "teacher", password: "Password01" },
  { name: "Evangeline Teall (test student)",  email: "evangeline.teall+student@ralphthoresby.com", role: "student", password: "Thoresby01" }
];

function seedAdmin() {
  SEED_ACCOUNTS.forEach(acc => {
    if (findUser(acc.email)) {
      Logger.log("Skipped (already exists): " + acc.email);
      return;
    }
    appendRow(SHEETS.USERS, {
      email: acc.email.toLowerCase(),
      name: acc.name,
      role: acc.role,
      passwordHash: hashPassword(acc.password),
      lastActive: new Date().toISOString()
    });
    Logger.log("Seeded: " + acc.email);
  });
}
