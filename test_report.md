# ZHCET Buddy — Diagnostic Report

**Generated:** Thu, 02 Apr 2026 19:25:01 GMT  
**Server:** `http://localhost:3000`  
**Total Cases:** 12  |  **Passed:** 12  |  **Failed:** 0  |  **Wall Time:** 375.6s

## Summary Table

| ID | Suite | Input | Expected Intent | Classified Intent | Expected Model | Model Used | Latency (ms) | Attempts | Content | Routing | Response Snippet |
|---|---|---|---|---|---|---|---|---|---|---|---|
| A1 | 1 · Greetings | Hello! | BASIC | BASIC | llama-3.3-70b-versatile | ⚠ qwen/qwen3-32b | 1012 | 2 | ✅ PASS | ⚠️ | Hello! How can I assist you today? 😊 |
| A2 | 1 · Greetings | What can you help me with? | BASIC | BASIC | llama-3.3-70b-versatile | ⚠ qwen/qwen3-32b | 47915 | 2 | ✅ PASS | ⚠️ | I can help with a wide range of academic queries! Here are the key areas I assist with: 1️⃣ **Course… |
| B1 | 2 · Case-Insensitive Data | show me courses for COMPUTER engineering semester 5 | DATA | DATA | qwen/qwen3-32b | qwen/qwen3-32b | 66667 | 1 | ✅ PASS | ✅ | Here are the courses for **COMPUTER ENGINEERING** in **Semester 5**: \| **Code**      \| **Title**    … |
| B2 | 2 · Case-Insensitive Data | list all courses for computer Engineering 3rd semester | DATA | DATA | qwen/qwen3-32b | qwen/qwen3-32b | 54874 | 1 | ✅ PASS | ✅ | Here are the courses for **COMPUTER ENGINEERING** in **Semester 3**: \| **Code**      \| **Title**    … |
| C1 | 3 · Timetable Precision | What classes do I have today for Computer Engineering semester 5? | DATA | DATA | qwen/qwen3-32b | ⚠ llama-3.1-8b-instant | 1487 | 3 | ✅ PASS | ⚠️ | Here is your schedule for **Computer Engineering** in **Semester 5** for **today**: **Friday** \| **T… |
| C2 | 3 · Timetable Precision | Who is my teacher at 11:20 AM tomorrow? | DATA | DATA | qwen/qwen3-32b | ⚠ llama-3.1-8b-instant | 37898 | 3 | ✅ PASS | ⚠️ | Since tomorrow is **Saturday**, I'll derive the exact weekday name using the current date. Tomorrow … |
| D1 | 4 · Honours Logic | I have a backlog, can I still get honours? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 2967 | 1 | ✅ PASS | ✅ | No. A backlog permanently disqualifies you from Honours. To earn Honours you must (a) finish with a … |
| D2 | 4 · Honours Logic | What CGPA do I need for First Division with Honours? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 11940 | 1 | ✅ PASS | ✅ | You need a **CGPA of 8.5 or higher** **and** you must have passed every course on the first attempt … |
| D3 | 4 · Honours Logic | How many credits do I need to graduate from B.Tech? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 27185 | 1 | ✅ PASS | ✅ | You must complete **180 credits** to graduate with a B.Tech degree. |
| E1 | 5 · Stress Test | Can I register for more than 40 credits this semester? | LOGIC | LOGIC | openai/gpt-oss-120b | openai/gpt-oss-120b | 20544 | 1 | ✅ PASS | ✅ | No. The absolute maximum credit limit per semester is **40 credits**. Registering for more than 40 c… |
| E2 | 5 · Stress Test | What are the library timings at ZHCET? | GENERAL | ⚠ BASIC | llama-3.3-70b-versatile | ⚠ qwen/qwen3-32b | 24811 | 2 | ✅ PASS | ⚠️ | It seems there was an error retrieving the library timings information. Currently, I cannot access r… |
| E3 | 5 · Stress Test | Show me the full course list for Artificial Intelligence semester 4 | DATA | DATA | qwen/qwen3-32b | qwen/qwen3-32b | 78196 | 1 | ✅ PASS | ✅ | Here is the course list for **Artificial Intelligence, Semester 4**: \| **Code**     \| **Title**     … |

---

## Suite: 1 · Greetings

**Passed:** 2 / 2   **Failed:** 0

### Case A1 — ✅ PASS
- **Input:** `Hello!`
- **Classified Intent:** `BASIC` (expected `BASIC`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `llama-3.3-70b-versatile`) ⚠️ mismatch
- **Latency:** 1012 ms  |  **Failover Attempts:** 2
- **Validation:** Received a greeting response
- **Response Snippet:**

  > Hello! How can I assist you today? 😊

### Case A2 — ✅ PASS
- **Input:** `What can you help me with?`
- **Classified Intent:** `BASIC` (expected `BASIC`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `llama-3.3-70b-versatile`) ⚠️ mismatch
- **Latency:** 47915 ms  |  **Failover Attempts:** 2
- **Validation:** Received a substantive help description
- **Response Snippet:**

  > I can help with a wide range of academic queries! Here are the key areas I assist with: 1️⃣ **Course…

<details><summary>Full response</summary>

```
I can help with a wide range of academic queries! Here are the key areas I assist with:

1️⃣ **Course Information**  
- List courses for your branch/semester  
- Check course details (credits, LTP, lab status)  
- Backlog registration rules (including first-year courses)  

2️⃣ **Registration Rules**  
- Mode A/B/C eligibility  
- Attendance condonation & detention policies  
- Promotion criteria & special registrations  

3️⃣ **Timetables**  
- View active classes for "today/tomorrow" or any weekday  
- Filter by branch/semester  

4️⃣ **Registration Card Validation**  
- Verify uploaded registration cards against official curriculum  

5️⃣ **General Guidelines**  
- Syllabi, placements, scholarships, library access, etc.  

6️⃣ **Academic Milestones**  
- CGPA requirements for branch change (7.5)  
- Honours eligibility (8.5 CGPA + zero backlogs)  
- Graduation credit threshold (180 total)  

Need help with anything specific? 😊
```
</details>

---

## Suite: 2 · Case-Insensitive Data

**Passed:** 2 / 2   **Failed:** 0

### Case B1 — ✅ PASS
- **Input:** `show me courses for COMPUTER engineering semester 5`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `qwen/qwen3-32b`) ✅
- **Latency:** 66667 ms  |  **Failover Attempts:** 1
- **Validation:** Course data returned without error
- **Response Snippet:**

  > Here are the courses for **COMPUTER ENGINEERING** in **Semester 5**: \| **Code**      \| **Title**    …

<details><summary>Full response</summary>

```
Here are the courses for **COMPUTER ENGINEERING** in **Semester 5**:

| **Code**      | **Title**                          | **Category** | **Credits** | **LTP**   |
|---------------|------------------------------------|--------------|-------------|-----------|
| COC3092       | Microprocessor Theory & Applications | PC           | 3           | 3-0-0     |
| COC3102       | Operating Systems                  | PC           | 4           | 3-1-0     |
| COC3162       | Software Engineering               | PC           | 3           | 3-0-0     |
| COC3932       | Algorithms & Operating Systems Lab   | PC           | 2           | 0-1-2     |
| COP3802       | Colloquium                         | PSI          | 2           | 0-2-0     |
| ELA3402       | Communication Systems              | ESA          | 4           | 3-1-0     |
| MEH3452       | Engineering Economy & Management   | HM           | 3           | 0-3-0     |
| **Open Elective-1** | (Course varies by student choice) | OE           | 3           | Varies    |

---

### Notes:
1. **Open Elective-1**: The specific course code, title, and LTP depend on your chosen elective. Refer to the Open Elective list in the academic calendar.
2. **Lab Course**: "Algorithms & Operating Systems Lab" (COC3932) includes practical sessions (P=2).
3. **Total Credits**: This semester requires **24 credits** (sum of all courses above).

Need details about a specific course? Let me know! 😊
```
</details>

### Case B2 — ✅ PASS
- **Input:** `list all courses for computer Engineering 3rd semester`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `qwen/qwen3-32b`) ✅
- **Latency:** 54874 ms  |  **Failover Attempts:** 1
- **Validation:** Course list returned
- **Response Snippet:**

  > Here are the courses for **COMPUTER ENGINEERING** in **Semester 3**: \| **Code**      \| **Title**    …

<details><summary>Full response</summary>

```
Here are the courses for **COMPUTER ENGINEERING** in **Semester 3**:

| **Code**      | **Title**                          | **Category** | **Credits** | **LTP**   |
|---------------|------------------------------------|--------------|-------------|-----------|
| AMS2612       | Higher Mathematics                 | BS           | 4           | 3-1-0     |
| COC2032       | Object Oriented Programming        | PC           | 4           | 3-1-0     |
| COC2062       | Data Structure and Algorithm     | PC           | 4           | 3-1-0     |
| COC2072       | Digital Logic and System Design  | PC           | 4           | 3-1-0     |
| COC2122       | Database Management System         | PC           | 4           | 3-1-0     |
| COC2932       | C & C++ Programming Lab            | PC           | 2           | 0-1-2     |
| ELA2112       | Electronic Devices & Circuits    | ESA          | 4           | 3-1-0     |

---

### Notes:
1. **Lab Course**: `COC2932` (C & C++ Programming Lab) includes practical sessions (P=2).
2. **Total Credits**: This semester requires **26 credits** (sum of all courses above).
3. **Categories**:
   - **PC**: Programme Core (mandatory courses)
   - **BS**: Basic Science
   - **ESA**: Engineering Science & Applied courses

Need details about a specific course? Let me know! 😊
```
</details>

---

## Suite: 3 · Timetable Precision

**Passed:** 2 / 2   **Failed:** 0

### Case C1 — ✅ PASS
- **Input:** `What classes do I have today for Computer Engineering semester 5?`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `llama-3.1-8b-instant` (expected `qwen/qwen3-32b`) ⚠️ mismatch
- **Latency:** 1487 ms  |  **Failover Attempts:** 3
- **Validation:** Timetable-aware response received
- **Response Snippet:**

  > Here is your schedule for **Computer Engineering** in **Semester 5** for **today**: **Friday** \| **T…

<details><summary>Full response</summary>

```
Here is your schedule for **Computer Engineering** in **Semester 5** for **today**:

**Friday**

| **Time** | **Course Code** | **Title** | **Professor** | **Room** | **Type** |
|----------|-----------------|-----------|---------------|----------|----------|
| 9:00-10:00 | COC3092 | Microprocessor Theory & Applications | Dr. S. Kumar | C-101 | Lecture |
| 10:10-11:10 | COC3102 | Operating Systems | Prof. R. Singh | C-202 | Lecture |
| 11:20-12:20 | COC3162 | Software Engineering | Dr. A. Khan | C-303 | Lecture |
| 2:00-3:00 | COC3932 | Algorithms & Operating Systems Lab | Prof. J. Ali | C-104 | Lab |

---

### Notes:
1. **Timetable**: This is your schedule for **today**, Friday.
2. **Room Numbers**: C-101, C-202, C-303, and C-104 are the rooms assigned for each class.
3. **Type**: Lecture and Lab sessions are scheduled for today.

Please check the room numbers and timings carefully before heading to your classes.
```
</details>

### Case C2 — ✅ PASS
- **Input:** `Who is my teacher at 11:20 AM tomorrow?`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `llama-3.1-8b-instant` (expected `qwen/qwen3-32b`) ⚠️ mismatch
- **Latency:** 37898 ms  |  **Failover Attempts:** 3
- **Validation:** Response contains day reference (expected "tomorrow" derivation)
- **Response Snippet:**

  > Since tomorrow is **Saturday**, I'll derive the exact weekday name using the current date. Tomorrow …

<details><summary>Full response</summary>

```
Since tomorrow is **Saturday**, I'll derive the exact weekday name using the current date. Tomorrow is **Saturday**.

Here is your schedule for **Computer Engineering** in **Semester 5** for **tomorrow**:

**Saturday**

| **Time** | **Course Code** | **Title** | **Professor** | **Room** | **Type** |
|----------|-----------------|-----------|---------------|----------|----------|
| 11:20-12:20 | ELA3402 | Communication Systems | Prof. M. Haque | E-205 | Lecture |

---

### Notes:
1. **Timetable**: This is your schedule for **tomorrow**, Saturday.
2. **Room Numbers**: E-205 is the room assigned for your class.
3. **Type**: Lecture session is scheduled for tomorrow.

Please check the room number and timing carefully before heading to your class.
```
</details>

---

## Suite: 4 · Honours Logic

**Passed:** 3 / 3   **Failed:** 0

### Case D1 — ✅ PASS
- **Input:** `I have a backlog, can I still get honours?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 2967 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly refused honours eligibility due to backlog
- **Response Snippet:**

  > No. A backlog permanently disqualifies you from Honours. To earn Honours you must (a) finish with a …

<details><summary>Full response</summary>

```
No. A backlog permanently disqualifies you from Honours. To earn Honours you must (a) finish with a CGPA ≥ 8.5 **and** (b) pass every course on the first attempt with no backlogs, failures, or repeats. If any backlog exists, Honours is not attainable, regardless of your final CGPA.
```
</details>

### Case D2 — ✅ PASS
- **Input:** `What CGPA do I need for First Division with Honours?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 11940 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly cited 8.5 CGPA + first-attempt rule
- **Response Snippet:**

  > You need a **CGPA of 8.5 or higher** **and** you must have passed every course on the first attempt …

<details><summary>Full response</summary>

```
You need a **CGPA of 8.5 or higher** **and** you must have passed every course on the first attempt (no backlogs, failures, or repeats). Both conditions are mandatory for First Division with Honours.
```
</details>

### Case D3 — ✅ PASS
- **Input:** `How many credits do I need to graduate from B.Tech?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 27185 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly cited 180 credits for B.Tech graduation
- **Response Snippet:**

  > You must complete **180 credits** to graduate with a B.Tech degree.

---

## Suite: 5 · Stress Test

**Passed:** 3 / 3   **Failed:** 0

### Case E1 — ✅ PASS
- **Input:** `Can I register for more than 40 credits this semester?`
- **Classified Intent:** `LOGIC` (expected `LOGIC`) ✅
- **Model Used:** `openai/gpt-oss-120b` (expected `openai/gpt-oss-120b`) ✅
- **Latency:** 20544 ms  |  **Failover Attempts:** 1
- **Validation:** Correctly enforced 40-credit hard cap
- **Response Snippet:**

  > No. The absolute maximum credit limit per semester is **40 credits**. Registering for more than 40 c…

<details><summary>Full response</summary>

```
No. The absolute maximum credit limit per semester is **40 credits**. Registering for more than 40 credits is strictly forbidden by the university ordinances.
```
</details>

### Case E2 — ✅ PASS
- **Input:** `What are the library timings at ZHCET?`
- **Classified Intent:** `BASIC` (expected `GENERAL`) ⚠️ mismatch
- **Model Used:** `qwen/qwen3-32b` (expected `llama-3.3-70b-versatile`) ⚠️ mismatch
- **Latency:** 24811 ms  |  **Failover Attempts:** 2
- **Validation:** Received a response about general info
- **Response Snippet:**

  > It seems there was an error retrieving the library timings information. Currently, I cannot access r…

<details><summary>Full response</summary>

```
It seems there was an error retrieving the library timings information. Currently, I cannot access real-time or specific operational hours for the ZHCET library. For the most accurate and updated library timings, I recommend checking the **official ZHCET website** or contacting the library administration directly. Would you like help with anything else?
```
</details>

### Case E3 — ✅ PASS
- **Input:** `Show me the full course list for Artificial Intelligence semester 4`
- **Classified Intent:** `DATA` (expected `DATA`) ✅
- **Model Used:** `qwen/qwen3-32b` (expected `qwen/qwen3-32b`) ✅
- **Latency:** 78196 ms  |  **Failover Attempts:** 1
- **Validation:** Course data returned
- **Response Snippet:**

  > Here is the course list for **Artificial Intelligence, Semester 4**: \| **Code**     \| **Title**     …

<details><summary>Full response</summary>

```
Here is the course list for **Artificial Intelligence, Semester 4**:

| **Code**     | **Title**                     | **Category** | **Credits** | **LTP**   |
|--------------|-------------------------------|--------------|-------------|-----------|
| AIC2042      | Principles of Machine Learning| PC           | 4           | 3-0-1     |
| AIC2142      | Design & Analysis of Algorithm| PC           | 4           | 3-0-1     |
| AIC2152      | AI Tools & Techniques         | PC           | 4           | 0-3-1     |
| AIC2912      | Data Structure Lab            | PC           | 2           | 0-1-2     |
| AIP2922      | Colloquium                    | PSI          | 2           | 0-0-2     |
| AMS2632      | Discrete Structures           | BS           | 4           | 0-3-1     |
| ELA2412      | Fundamentals of Digital Sig Proc | ESA      | 4           | 3-0-1     |
| ELA2902      | Electronics Laboratory        | ESA          | 2           | 0-1-2     |

### Notes:
- **PC** = Program Core (mandatory AI courses)  
- **PSI** = Program Skill (skill development)  
- **BS** = Basic Science (math/theory)  
- **ESA** = Engineering Science & Analysis (elective/related field)  
- Labs (P > 0) require practical sessions.  

Let me know if you need details about any specific course! 😊
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