const tests = [
  {
    name: 'Parity Edge Case',
    query: 'I am a Computer Engineering student in semester 5. Can I register for AIC2042?',
    check: (res) => res.toLowerCase().includes('strictly forbidden') || res.toLowerCase().includes('parity mismatch') || res.toLowerCase().includes('cannot cross-register') || res.toLowerCase().includes('not permitted'),
  },
  {
    name: 'First-Year Exception',
    query: 'I am in semester 3 but I have a backlog in semester 1 Applied Physics. Can I register for it?',
    check: (res) => res.toLowerCase().includes('permitted') || res.toLowerCase().includes('first-year') || res.toLowerCase().includes('exception'),
  },
  {
    name: 'Honours & Backlog Test',
    query: 'My CGPA is 9.2 but I had one backlog in the second semester. Am I eligible for Honours?',
    check: (res) => res.toLowerCase().includes('honours') && (res.toLowerCase().includes('disqualified') || res.toLowerCase().includes('ineligible') || res.toLowerCase().includes('no') || res.toLowerCase().includes('permanently')),
  },
  {
    name: 'Absolute Credit Limit',
    query: 'I want to finish quickly. Can I register for 42 credits this semester?',
    check: (res) => res.replace(/[^0-9a-zA-Z]/g, '').toLowerCase().includes('40credits') || res.toLowerCase().includes('forbidden') || res.toLowerCase().includes('maximum') || res.toLowerCase().includes('prohibited'),
  },
  {
    name: 'Day-Aware Timetable Test',
    query: 'What is my Computer Engineering Semester 5 schedule for tomorrow?',
    check: (res) => res.toLowerCase().includes('tomorrow') || res.toLowerCase().includes('schedule for') || res.toLowerCase().includes('no classes scheduled'),
  },
  {
    name: 'Multi-hop Logic Test',
    query: 'Do NPTEL courses count towards my graduation credits, and how many minimum credits can I take online?',
    check: (res) => res.toLowerCase().includes('12') && (res.toLowerCase().includes('credit') || res.toLowerCase().includes('online')),
  }
];

async function runTests() {
  console.log('--- Starting ZHCET AI Completeness Tests ---\n');
  let passed = 0;
  for (let i = 0; i < tests.length; i++) {
    const test = tests[i];
    console.log(`[TEST ${i + 1}] ${test.name}`);
    console.log(`Query: "${test.query}"`);
    try {
      const sessionId = `test_session_clean_${Date.now()}_${i}`;
      
      const response = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: test.query, sessionId })
      });
      
      if (!response.ok) {
        throw new Error(`Server returned status ${response.status}`);
      }

      const data = await response.json();
      const aiResponse = data.response || '';
      console.log('\nAI Response:');
      console.log(aiResponse);
      const isPass = test.check(aiResponse);
      
      if (isPass) {
        console.log(`\n✅ RESULT: PASS\n`);
        passed++;
      } else {
        console.log(`\n❌ RESULT: FAIL\n`);
      }
    } catch (e) {
      console.error(`\n❌ ERROR: ${e.message}\n`);
      if (e.message.includes('500') || e.message.includes('429')) {
         console.error('Possible Rate limit or Server 500 error. Please check the API key setup.');
         process.exit(1);
      }
    }
    console.log('-'.repeat(50) + '\n');
  }
  
  console.log(`\n--- Completed: ${passed}/${tests.length} tests passed ---`);
}

runTests();
