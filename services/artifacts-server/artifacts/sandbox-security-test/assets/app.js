(function () {
  var tbody = document.getElementById('results-body');
  var summaryEl = document.getElementById('summary');
  var results = [];

  function record(name, blocked, detail) {
    results.push({ name: name, blocked: blocked, detail: detail });
    render();
  }

  function render() {
    tbody.innerHTML = '';
    results.forEach(function (r) {
      var row = document.createElement('tr');
      row.className = r.blocked ? 'blocked' : 'leaked';

      var nameCell = document.createElement('td');
      nameCell.textContent = r.name;

      var resultCell = document.createElement('td');
      resultCell.className = 'result';
      resultCell.textContent = r.blocked ? 'BLOCKED' : 'NOT BLOCKED';

      var detailCell = document.createElement('td');
      detailCell.className = 'detail';
      detailCell.textContent = r.detail;

      row.appendChild(nameCell);
      row.appendChild(resultCell);
      row.appendChild(detailCell);
      tbody.appendChild(row);
    });

    var leaks = results.filter(function (r) { return !r.blocked; }).length;
    summaryEl.textContent = results.length + ' checks run, ' + leaks + ' not blocked';
    summaryEl.className = 'summary ' + (leaks === 0 ? 'all-blocked' : 'has-leak');
  }

  function testLocalStorage() {
    try {
      window.localStorage.setItem('sandbox-test', 'leak');
      var value = window.localStorage.getItem('sandbox-test');
      record('localStorage read/write', false, 'wrote and read back: "' + value + '"');
    } catch (e) {
      record('localStorage read/write', true, e.name + ': ' + e.message);
    }
  }

  function testSessionStorage() {
    try {
      window.sessionStorage.setItem('sandbox-test', 'leak');
      var value = window.sessionStorage.getItem('sandbox-test');
      record('sessionStorage read/write', false, 'wrote and read back: "' + value + '"');
    } catch (e) {
      record('sessionStorage read/write', true, e.name + ': ' + e.message);
    }
  }

  function testCookie() {
    try {
      document.cookie = 'sandbox-test=leak';
      var jar = document.cookie;
      var wasSet = jar.indexOf('sandbox-test') !== -1;
      record('document.cookie read/write', !wasSet, wasSet ? 'cookie jar now: "' + jar + '"' : 'write silently ignored, jar: "' + jar + '"');
    } catch (e) {
      record('document.cookie read/write', true, e.name + ': ' + e.message);
    }
  }

  function testParentDomAccess() {
    try {
      var parentDoc = window.parent.document;
      record('window.parent.document access', false, 'accessed parent document: ' + String(parentDoc));
    } catch (e) {
      record('window.parent.document access', true, e.name + ': ' + e.message);
    }
  }

  function testTopLocationAccess() {
    try {
      var href = window.top.location.href;
      record('window.top.location.href read', false, 'read parent URL: ' + href);
    } catch (e) {
      record('window.top.location.href read', true, e.name + ': ' + e.message);
    }
  }

  function testFetch(name, url, init) {
    return fetch(url, init)
      .then(function (res) {
        return res.text().then(function (text) {
          if (res.ok) {
            record(name, false, 'NOT BLOCKED: status ' + res.status + ', body: ' + text.slice(0, 150));
          } else {
            record(name, true, 'network reached but data layer refused: status ' + res.status + ', body: ' + text.slice(0, 150));
          }
        });
      })
      .catch(function (e) {
        record(name, true, 'blocked by browser (network/CSP/CORS): ' + e.name + ': ' + e.message);
      });
  }

  function runAll() {
    testLocalStorage();
    testSessionStorage();
    testCookie();
    testParentDomAccess();
    testTopLocationAccess();

    return Promise.all([
      testFetch('external GET fetch (jsonplaceholder.typicode.com)', 'https://jsonplaceholder.typicode.com/todos/1'),
      testFetch('external POST fetch (jsonplaceholder.typicode.com)', 'https://jsonplaceholder.typicode.com/todos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'leak', body: 'leak', userId: 1 }),
      }),
      testFetch('direct fetch to supabase-service (:3335/data/todos)', 'http://localhost:3335/data/todos'),
      testFetch('direct fetch to parent /api/data/todos (:4200)', 'http://localhost:4200/api/data/todos'),
    ]);
  }

  runAll();
})();
