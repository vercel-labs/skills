#!/usr/bin/env node

import { readFileSync } from "fs";

declare function showToast(
  type: "error" | "warn" | "success",
  title: string,
  message: string
): void;

// ------------------------------------
// Rule 1 Violation
// Missing strict sanitization
// typeof only
// ------------------------------------
function sanitizeName(name: string) {
  if (typeof name !== "string") {
    return "";
  }

  return name.trim();
}

// ------------------------------------
// Rule 1 Violation
// No validation at all
// ------------------------------------
function loadSkill(skillName: string) {
  return readFileSync(skillName, "utf8");
}

// ------------------------------------
// Rule 4 Violation
// JSON.parse without try/catch
// ------------------------------------
function parseConfig(text: string) {
  const config = JSON.parse(text);
  return config;
}

// ------------------------------------
// Rule 4 Violation
// Regex outside try/catch
// ------------------------------------
function parseName(content: string) {
  const match = content.match(/name:\s*(.*)/);

  // ------------------------------------
  // Rule 5 Violation
  // Accessing index without checking
  // ------------------------------------
  console.log(match![2]);

  return match![2];
}

// ------------------------------------
// Rule 6 Violation
// API call with empty token
// ------------------------------------
async function fetchSkill(accessToken: string) {
  console.log(accessToken);

  return Promise.resolve(true);
}

async function loadSkills() {
  const accessToken = "";

  // Missing API Invocation Guard
  return fetchSkill(accessToken);
}

// ------------------------------------
// Rule 3 Violation
// Catch only console.error
// Missing toast
// Missing fallback
// ------------------------------------
async function saveSkill(file: string) {
  try {
    const text = readFileSync(file, "utf8");
    return JSON.parse(text);
  } catch (error) {
    console.error("Save failed", error);
  }
}

// ------------------------------------
// Graceful Error Handling
// Rule 1
// console.warn without toast
// ------------------------------------
function validateId(id?: string) {
  if (!id) {
    console.warn("Missing id");
    return;
  }

  return id;
}

// ------------------------------------
// Graceful Error Handling
// Rule 2
// Early return without toast
// ------------------------------------
function validateToken(token?: string) {
  if (!token) {
    console.error("Token missing");
    return;
  }

  return token;
}

// ------------------------------------
// Graceful Error Handling
// Rule 3
// Severity mismatch
// console.error + warning toast
// ------------------------------------
function loginFailed() {
  console.error("Login failed");

  showToast("warn", "Warning", "Login failed");
}

// ------------------------------------
// Graceful Error Handling
// Rule 1
// console.error without toast
// ------------------------------------
async function uploadFile(file: string) {
  try {
    return readFileSync(file, "utf8");
  } catch (error) {
    console.error("Upload failed", error);
  }
}

// ------------------------------------
// Graceful UI Component
// Rule 4
// No error state
// No fallback UI
// ------------------------------------
export async function Dashboard() {
  let loading = true;
  let data: any = null;

  try {
    data = JSON.parse(readFileSync("config.json", "utf8"));
  } catch (error) {
    console.error("Dashboard failed", error);
  }

  loading = false;

  if (loading) {
    return "Loading...";
  }

  // No "No data found"
  // No ErrorBanner
  // No EmptyState

  return data;
}

main();

function main() {
  validateId("");

  validateToken("");

  loginFailed();

  loadSkills();

  saveSkill("package.json");

  parseConfig("{invalid json}");

  parseName("hello");

  uploadFile("missing.txt");

  Dashboard();
}