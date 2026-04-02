# ZHCET Buddy: Comprehensive System Test Suite

This test suite is designed to stress-test the **ZHCET Buddy** assistant's memory, reasoning, and data retrieval capabilities. It focuses on the specific "Agentic" improvements and grounding rules implemented in your codebase.

---

## 🧠 Suite 1: Identity, Memory & Context Retention
**Goal:** Verify that the "Intent Pinning" and "Summarization" logic prevents the bot from forgetting user details after a long conversation.

### Test Case 1.1: The Long Thread Reset
1.  **Primary Question:** "Hi, I am a Computer Engineering student in my 4th semester. Can you tell me what the 65% attendance rule means for me?"
2.  **Follow-up (Distractor 1):** "Thanks. By the way, do you know what the scientific name for a lion is?"
3.  **Follow-up (Distractor 2):** "Cool. Also, what is the current weather in Aligarh?"
4.  **Follow-up (Context Check):** "Wait, back to my studies—what is the name of my professor for the class I have at 11:20 AM tomorrow?"
    * **Success Criteria:** The bot must correctly identify **Friday** (tomorrow) and state there is **no class** at 11:20 AM for **Computer Engineering Semester 4**, without asking for your branch again.

---

## ⚖️ Suite 2: Promotion & Ordinance Reasoning
**Goal:** Test the system's ability to reason through complex, multi-variable university rules.

### Test Case 2.1: The Credit Threshold Trap
1.  **Primary Question:** "I have earned 59 credits by the end of my 4th semester. Am I eligible for promotion to the 5th semester?"
    * **Success Criteria:** The bot must say **No**, as the minimum requirement is 60 credits.
2.  **Follow-up:** "Okay, I found a missing grade and now I have 61 credits total. But only 34 of them are from my 1st and 2nd semesters combined. Am I promoted now?"
    * **Success Criteria:** The bot must say **No**. Promotion to the 5th/6th semester requires at least 36 credits from the first two semesters specifically.

### Test Case 2.2: The First-Year Parity Exception
1.  **Primary Question:** "I'm in my 4th semester (Even). Can I register for a backlog course from my 3rd semester (Odd) right now?"
    * **Success Criteria:** The bot should say **No**, because backlog registration usually follows odd/even parity.
2.  **Follow-up:** "What if the backlog is 'Applied Physics' from my 1st semester? Can I take that in this even semester?"
    * **Success Criteria:** The bot must say **Yes**. First-year courses are a "Critical Exception" and are offered in both semesters.

---

## 📅 Suite 3: Timetable & Tool Accuracy
**Goal:** Test the accuracy of schedule retrieval and the handling of ambiguous groups.

### Test Case 3.1: Group Lab Conflict
1.  **Primary Question:** "Show me my schedule for Tuesday afternoon. I'm in Computer Engineering, 4th Semester."
    * **Success Criteria:** The bot should list two labs: **Digital Design & Simulation** (Group G2) and **Electronics Laboratory** (Group G1).
2.  **Follow-up:** "I'm in Group G2. Which lab should I go to and who are the professors?"
    * **Success Criteria:** It must identify the **Digital Design & Simulation Lab** and list the professors (Prof. Beg, Prof. Izharuddin, etc.).

---

## 🛠️ Suite 4: Self-Healing & Grounding (Stress Test)
**Goal:** Trigger the bot's "Self-Healing" loops and verify it doesn't hallucinate generic data.

### Test Case 4.1: Grounding "The 180 Rule"
1.  **Primary Question:** "I heard B.Tech only needs 160 credits to graduate. Is that true for me?"
    * **Success Criteria:** The bot must definitively correct this to **180 credits** using its knowledge base, without narrating that it is "calling a tool".

### Test Case 4.2: Maximum Workload
1.  **Primary Question:** "I want to finish my degree early. Can I register for 45 credits next semester?"
    * **Success Criteria:** The bot must state the maximum limit is **40 credits** per semester.

---

## 💰 Suite 5: General Info & Financials
**Goal:** Test retrieval from the Markdown knowledge base.

### Test Case 5.1: The Book Bank Penalty
1.  **Primary Question:** "Tell me about the Book Bank. How much do I have to pay to get my 4th-semester books?"
    * **Success Criteria:** It should mention the **15% of the total cost** hire charge.
2.  **Follow-up:** "What happens if I forget to return them and I am 10 days late after the exams?"
    * **Success Criteria:** It must specify a fine of **₹1.00 per day per book**.

To test the capabilities of a system trained on these ZHCET documents, questions should range from simple data retrieval to complex logical reasoning involving multiple files (Ordinances, Course Lists, and Timetables).

Here are detailed test questions categorized by complexity:

---

## 1. Regulatory & Eligibility Logic
**Goal:** Test the system's ability to interpret "The Ordinances" and "Registration Rules."

* **Scenario A: Branch Change**
    * **Question:** "I am a first-year student with a CGPA of 7.8. I passed all my exams, but I was absent for one mid-term (Internal Exam). Can I apply for a branch change? What are the specific constraints that might prevent my transfer even if I meet the merit criteria?"
    * **Follow-up:** "If the branch I want to join is popular and many people are leaving my current branch, at what point does the University legally have to stop allowing transfers out of my department?"

* **Scenario B: Attendance & Detention**
    * **Question:** "I am repeating a course this semester because I failed the theory exam last year, but I had 80% attendance back then. If my current attendance drops to 40% due to an internship, can the department detain me from the End-Semester exam?"
    * **Follow-up:** "Since I'm repeating this theory course and already fulfilled attendance, which registration modes (b or c) are available to me, and how do they differ regarding sessional marks?"

---

## 2. Cross-Document Data Synthesis
**Goal:** Test if the system can link a student's specific schedule to the broader academic rules.

* **Scenario C: Credit Limits & Scheduling**
    * **Question:** "I am in B.Tech Computer Engineering, Semester 4. Based on my active timetable, I have a lab on Monday from 2:00 PM to 4:30 PM. If I want to register for an extra backlog course from the AI branch (Semester 4), what is the maximum number of total credits I can carry this semester, and what logistical conflict might I face on Mondays?"
    * **Follow-up:** "If the AI course I want to take is a 'Programme Core' (PC), how many credits does it typically carry, and would adding it put me over the 40-credit limit?"

---

## 3. Complex Calculations & Promotion Rules
**Goal:** Test mathematical logic and "Not Promoted" criteria.

* **Scenario D: The Promotion Hurdle**
    * **Question:** "A student has finished their 4th semester. They have earned 30 credits from their first year and 25 credits from their second year. Will they be promoted to the 5th semester? Explain the specific credit deficit based on the 108/80/60 rule."
    * **Follow-up:** "If this is their third time being 'Not Promoted,' what is their last resort to stay in the program, and what is the absolute maximum time they have to graduate?"

---

## 4. Specific Course & Category Queries
**Goal:** Test granular knowledge of the 2023-24 curriculum structure.

* **Scenario E: Minor Degrees & Online Learning**
    * **Question:** "I want to get a Minor Degree in Artificial Intelligence. What is the CGPA requirement to start, and how many 'additional' credits must I earn beyond my major requirements?"
    * **Follow-up:** "The 2023-24 Ordinances mention online courses. How many credits from MOOCS/NPTEL are mandatory, and which course categories (PE/OE) can they satisfy?"

---

## 5. Library & Administrative Details
**Goal:** Test retrieval of specific "General Info" and "Regulations."

* **Scenario F: The Book Bank System**
    * **Question:** "I am a B.Tech student and I need a full set of textbooks. How much do I have to pay as a hire charge, and where exactly do I deposit the fine if I return them 5 days late?"
    * **Follow-up:** "Does the library timing change on Fridays, and can I access IEEE e-journals from my hostel via the LAN?"

---

## 6. Faculty Coding Logic
**Goal:** Test understanding of the "Course Numbering" system.

* **Question:** "Look at course code **COC3112**. Break down what each character represents based on the Regulations. Which department offers it, what is the category, what year is it for, and what type of course (theory/lab) is it?"

---