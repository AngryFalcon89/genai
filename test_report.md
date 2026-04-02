# ZHCET Buddy — Diagnostic Report

**Generated:** Thu, 02 Apr 2026 20:31:07 GMT  
**Server:** `http://localhost:3000`  
**Total Cases:** 12  |  **Passed:** 11  |  **Failed:** 1  |  **Wall Time:** 403.7s

## Summary Table

| ID | Suite | Input | Expected Intent | Classified Intent | Expected Model | Model Used | Latency (ms) | Attempts | Content | Routing | Response Snippet |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 1 · Greetings | Hello! | BASIC | BASIC | llama-3.3-70b-versatile | ⚠ qwen/qwen3-32b | 832 | 2 | ✅ PASS | ⚠️ | Hello! How can I assist you today? |
| A2 | 1 · Greetings | What can you help me with? | BASIC | BASIC | llama-3.3-70b-versatile | ⚠ qwen/qwen3-32b | 48867 | 2 | ✅ PASS | ⚠️ | I can help you with:   - **Course Information**: Check your semester's courses (including PC/PE/OE c… |
| B1 | 2 · Case-Insensitive Data | show me courses for COMPUTER engineering semester 5 | DATA | DATA | qwen/qwen3-32b | qwen/qwen3-32b | 62349 | 1 | ✅ PASS | ✅ | Here are the **5th-semester courses** for **Computer Engineering** at ZHCET: \| **Code**     \| **Titl… |
| B2 | 2 · Case-Insensitive Data | list all courses for computer Engineering 3rd semester | DATA | ⚠ N/A | qwen/qwen3-32b | ⚠ N/A | N/A | N/A | ❌ FAIL | ⚠️ | (no response) |
| C1 | 3 · Timetable Precision | What classes do I have today for Computer Engineering semester 5? | DATA | DATA | qwen/qwen3-32b | ⚠ llama-3.1-8b-instant | 6368 | 3 | ✅ PASS | ⚠️ | Here is your schedule for **Friday**: There are no classes scheduled for **Friday**. |
| C2 | 3 · Timetable Precision | Who is my teacher at 11:20 AM tomorrow? | DATA | DATA | qwen/qwen3-32b | qwen/qwen3-32b | 42911 | 1 | ✅ PASS | ✅ | Here is your schedule for **Saturday**: \| **Time**       \| **Course Code** \| **Title**              … |
| D1 | 4 · Honours Logic | I have a backlog, can I still get honours? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 3287 | 1 | ✅ PASS | ✅ | No. A backlog permanently disqualifies you from Honours. To earn Honours you must have a CGPA ≥ 8.5 … |
| D2 | 4 · Honours Logic | What CGPA do I need for First Division with Honours? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 19206 | 1 | ✅ PASS | ✅ | You need a **CGPA of 8.5 or higher** **and** you must have passed every single course on the first a… |
| D3 | 4 · Honours Logic | How many credits do I need to graduate from B.Tech? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 21015 | 1 | ✅ PASS | ✅ | You need **180 credits** to graduate from the B.Tech program. |
| E1 | 5 · Stress Test | Can I register for more than 40 credits this semester? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 50130 | 1 | ✅ PASS | ✅ | No. The maximum credit limit per semester is strictly 40 credits. Registering for more than 40 credi… |
| E2 | 5 · Stress Test | What are the library timings at ZHCET? | GENERAL | ⚠ BASIC | llama-3.3-70b-versatile | ⚠ qwen/qwen3-32b | 21761 | 2 | ✅ PASS | ⚠️ | I couldn't find specific library timings in the available guidelines. For the most accurate and up-t… |
| E3 | 5 · Stress Test | Show me the full course list for Artificial Intelligence semester 4 | DATA | DATA | qwen/qwen3-32b | ⚠ llama-3.1-8b-instant | 83224 | 3 | ✅ PASS | ⚠️ | Here is the full course list for Artificial Intelligence semester 4: \| Code \| Title \| Category \| Cre… |

---

## Suite: 1 · Greetings

**Passed:** 2 / 2   **Failed:** 0

### Case A1 — ✅ PASS
- **Input:** `Hello!`
- **Classified Intent:** `BASIC` (expected `BASIC`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `llama-3.3-70b-versatile`) ⚠️ mismatch
- **Latency:** 832 ms  |  **Failover Attempts:** 2
- **Validation:** Received a greeting response
- **Response Snippet:**

  > Hello! How can I assist you today?

### Case A2 — ✅ PASS
- **Input:** `What can you help me with?`
- **Classified Intent:** `BASIC` (expected `BASIC`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `llama-3.3-70b-versatile`) ⚠️ mismatch
- **Latency:** 48867 ms  |  **Failover Attempts:** 2
- **Validation:** Received a substantive help description
- **Response Snippet:**

  > I can help you with:   - **Course Information**: Check your semester's courses (including PC/PE/OE c…

<details><summary>Full response</summary>

```
I can help you with:  
- **Course Information**: Check your semester's courses (including PC/PE/OE categories), course details (credits, LTP, labs), and registration eligibility.  
- **Registration Rules**: Clarify policies on modes of registration (A/B/C), backlogs, attendance, promotions, and special registrations.  
- **Timetables**: View your class schedule for a specific day (e.g., "What’s my schedule for Friday?").  
- **General Guidelines**: Search for info on syllabi, placements, scholarships, library rules, etc.  
- **Registration Card Validation**: Verify if your uploaded registration card matches the official curriculum.  
- **Credit/CGPA Requirements**: Confirm graduation credits (180 total), max credits per semester (40), or Honours/Branch Change thresholds.  

Let me know what you’d like to explore! 😊
```
</details>

---

## Suite: 2 · Case-Insensitive Data

**Passed:** 1 / 2   **Failed:** 1

### Case B1 — ✅ PASS
- **Input:** `show me courses for COMPUTER engineering semester 5`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `qwen/qwen3-32b`) ✅
- **Latency:** 62349 ms  |  **Failover Attempts:** 1
- **Validation:** Course data returned without error
- **Response Snippet:**

  > Here are the **5th-semester courses** for **Computer Engineering** at ZHCET: \| **Code**     \| **Titl…

<details><summary>Full response</summary>

```
Here are the **5th-semester courses** for **Computer Engineering** at ZHCET:

| **Code**     | **Title**                     | **Category** | **Credits** | **LTP**   |
|--------------|-------------------------------|--------------|-------------|-----------|
| COC3092      | Microprocessor Theory & Applications | PC          | 3           | 3-0-0     |
| COC3102      | Operating Systems             | PC          | 4           | 3-1-0     |
| COC3162      | Software Engineering          | PC          | 3           | 3-0-0     |
| COC3932      | Algorithms & Operating Systems Lab | PC      | 2           | 0-1-2     |
| COP3802      | Colloquium                    | PSI         | 2           | 0-2-0     |
| ELA3402      | Communication Systems         | ESA         | 4           | 3-1-0     |
| MEH3452      | Engineering Economy & Management | HM      | 3           | 0-3-0     |
| **Open Elective-1** | (Code pending)              | OE          | 3           | -         |

### Notes:
1. **Total Credits**: 24 (Theory: 21 + Practical: 3).
2. **Open Elective-1**: The specific course code and LTP will depend on your chosen elective. Check the university’s OE list for options.
3. **Lab Component**: COC3932 includes a lab (Practical: 2 hours).

Let me know if you need details about any course! 😊
```
</details>

### Case B2 — ❌ FAIL
- **Input:** `list all courses for computer Engineering 3rd semester`
- **Classified Intent:** `N/A` (expected `DATA`) ⚠️ mismatch
- **Model Used:** `N/A` (expected `qwen/qwen3-32b`) ⚠️ mismatch
- **Latency:** N/A  |  **Failover Attempts:** N/A
- **Validation:** Request failed: HTTP 500: {"error":"Internal server error"}
- **Response Snippet:**

  > (no response)

---

## Suite: 3 · Timetable Precision

**Passed:** 2 / 2   **Failed:** 0

### Case C1 — ✅ PASS
- **Input:** `What classes do I have today for Computer Engineering semester 5?`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `llama-3.1-8b-instant` (expected `qwen/qwen3-32b`) ⚠️ mismatch
- **Latency:** 6368 ms  |  **Failover Attempts:** 3
- **Validation:** Timetable-aware response received
- **Response Snippet:**

  > Here is your schedule for **Friday**: There are no classes scheduled for **Friday**.

### Case C2 — ✅ PASS
- **Input:** `Who is my teacher at 11:20 AM tomorrow?`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `qwen/qwen3-32b`) ✅
- **Latency:** 42911 ms  |  **Failover Attempts:** 1
- **Validation:** Response contains day reference (expected "tomorrow" derivation)
- **Response Snippet:**

  > Here is your schedule for **Saturday**: \| **Time**       \| **Course Code** \| **Title**              …

<details><summary>Full response</summary>

```
Here is your schedule for **Saturday**:

| **Time**       | **Course Code** | **Title**               | **Professor**       | **Room** | **Type** |
|----------------|------------------|-------------------------|---------------------|----------|----------|
| 11:20 AM - 12:10 PM | COC3102         | Operating Systems       | Dr. A.R. Khan       | 507      | Theory   |

You have **Operating Systems** with **Dr. A.R. Khan** at 11:20 AM tomorrow (Saturday). The class is in **Room 507**.
```
</details>

---

## Suite: 4 · Honours Logic

**Passed:** 3 / 3   **Failed:** 0

### Case D1 — ✅ PASS
- **Input:** `I have a backlog, can I still get honours?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 3287 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly refused honours eligibility due to backlog
- **Response Snippet:**

  > No. A backlog permanently disqualifies you from Honours. To earn Honours you must have a CGPA ≥ 8.5 …

<details><summary>Full response</summary>

```
No. A backlog permanently disqualifies you from Honours. To earn Honours you must have a CGPA ≥ 8.5 **and** have passed every course on the first attempt with no backlogs, failures, or repeats.
```
</details>

### Case D2 — ✅ PASS
- **Input:** `What CGPA do I need for First Division with Honours?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 19206 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly cited 8.5 CGPA + first-attempt rule
- **Response Snippet:**

  > You need a **CGPA of 8.5 or higher** **and** you must have passed every single course on the first a…

<details><summary>Full response</summary>

```
You need a **CGPA of 8.5 or higher** **and** you must have passed every single course on the first attempt (no backlogs, failures, or repeats). Only when both conditions are met do you qualify for **First Division with Honours**.
```
</details>

### Case D3 — ✅ PASS
- **Input:** `How many credits do I need to graduate from B.Tech?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 21015 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly cited 180 credits for B.Tech graduation
- **Response Snippet:**

  > You need **180 credits** to graduate from the B.Tech program.

---

## Suite: 5 · Stress Test

**Passed:** 3 / 3   **Failed:** 0

### Case E1 — ✅ PASS
- **Input:** `Can I register for more than 40 credits this semester?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 50130 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly enforced 40-credit hard cap
- **Response Snippet:**

  > No. The maximum credit limit per semester is strictly 40 credits. Registering for more than 40 credi…

<details><summary>Full response</summary>

```
No. The maximum credit limit per semester is strictly 40 credits. Registering for more than 40 credits is not permitted.
```
</details>

### Case E2 — ✅ PASS
- **Input:** `What are the library timings at ZHCET?`
- **Classified Intent:** `BASIC` (expected `GENERAL`) ⚠️ mismatch
- **Model Used:** `qwen/qwen3-32b` (expected `llama-3.3-70b-versatile`) ⚠️ mismatch
- **Latency:** 21761 ms  |  **Failover Attempts:** 2
- **Validation:** Received a response about general info
- **Response Snippet:**

  > I couldn't find specific library timings in the available guidelines. For the most accurate and up-t…

<details><summary>Full response</summary>

```
I couldn't find specific library timings in the available guidelines. For the most accurate and up-to-date information, I recommend checking the **official ZHCET website** or contacting the library directly. Would you like help with anything else?
```
</details>

### Case E3 — ✅ PASS
- **Input:** `Show me the full course list for Artificial Intelligence semester 4`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `llama-3.1-8b-instant` (expected `qwen/qwen3-32b`) ⚠️ mismatch
- **Latency:** 83224 ms  |  **Failover Attempts:** 3
- **Validation:** Course data returned
- **Response Snippet:**

  > Here is the full course list for Artificial Intelligence semester 4: \| Code \| Title \| Category \| Cre…

<details><summary>Full response</summary>

```
Here is the full course list for Artificial Intelligence semester 4:

| Code | Title | Category | Credits | LTP |
| --- | --- | --- | --- | --- |
| AIC2042 | Principles of Machine Learning | PC | 4 | 3-0-1 |
| AIC2142 | Design & Analysis of Algorithm | PC | 4 | 3-0-1 |
| AIC2152 | AI Tools & Techniques | PC | 4 | 0-3-1 |
| AIC2912 | Data Structure Lab | PC | 2 | 0-1-2 |
| AIP2922 | Colloquium | PSI | 2 | 0-0-2 |
| AMS2632 | Discrete Structures | BS | 4 | 0-3-1 |
| ELA2412 | Fundamentals of Digital Sig Proc | ESA | 4 | 3-0-1 |
| ELA2902 | Electronics Laboratory | ESA | 2 | 0-1-2 |
```
</details>

---

## Model Legend

| Constant | Model ID | Role |
|---|---|---|
| `ROUTER_MODEL` | `llama-3.1-8b-instant` | Lightweight intent classifier |
| `TIER1_MODEL`  | `openai/gpt-oss-120b`  | LOGIC — ordinance / honours reasoning |
| `TIER2_MODEL`  | `llama-3.3-70b-versatile` | GENERAL — basic info, greetings |
| `TIER3_MODEL`  | `qwen/qwen3-32b`    | DATA — timetables, course lists |

> Latency figures are **server-side** (from `performance.now()` inside `getChatResponse`).
> "Attempts" = 1 means the preferred model responded on the first try; higher values indicate failover.

*Report generated by `diagnose_buddy.js`*