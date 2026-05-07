export function renderJsonDbViewer(options = {}) {
  const graphqlPath = options.graphqlPath ?? '/graphql';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>jsondb viewer</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script src="https://unpkg.com/htmx.org@2.0.4"></script>
  <style>
    :root {
      color-scheme: light;
      --bg: #f7f8fb;
      --panel: #ffffff;
      --panel-soft: #f0f4f8;
      --text: #17202a;
      --muted: #627386;
      --line: #d8e0e8;
      --accent: #1f7a68;
      --accent-dark: #15594d;
      --warn: #9a5b00;
      --danger: #b3261e;
      --code: #101923;
      --code-text: #e7eef7;
      --focus: #2f80ed;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    button,
    input,
    select,
    textarea {
      font: inherit;
    }

    button,
    select {
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--panel);
      color: var(--text);
      min-height: 34px;
      padding: 6px 10px;
    }

    button {
      cursor: pointer;
    }

    button.primary {
      border-color: var(--accent);
      background: var(--accent);
      color: #fff;
    }

    button:hover {
      border-color: var(--accent);
    }

    button.primary:hover {
      background: var(--accent-dark);
    }

    button:focus-visible,
    select:focus-visible,
    textarea:focus-visible,
    input:focus-visible {
      outline: 2px solid var(--focus);
      outline-offset: 2px;
    }

    textarea,
    pre {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
    }

    textarea {
      width: 100%;
      min-height: 160px;
      resize: vertical;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 10px;
      background: #fff;
      color: var(--text);
    }

    pre {
      margin: 0;
      overflow: auto;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }

    .app {
      min-height: 100vh;
      display: grid;
      grid-template-rows: auto 1fr;
    }

    header {
      border-bottom: 1px solid var(--line);
      background: var(--panel);
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
    }

    h1,
    h2,
    h3 {
      margin: 0;
      line-height: 1.2;
      letter-spacing: 0;
    }

    h1 {
      font-size: 18px;
      font-weight: 700;
    }

    h2 {
      font-size: 16px;
      font-weight: 700;
    }

    h3 {
      font-size: 13px;
      font-weight: 700;
    }

    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .pill {
      border: 1px solid var(--line);
      border-radius: 999px;
      background: var(--panel-soft);
      color: var(--muted);
      padding: 4px 8px;
      font-size: 12px;
      white-space: nowrap;
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
      min-height: 0;
    }

    aside {
      border-right: 1px solid var(--line);
      background: #fbfcfe;
      padding: 14px;
      overflow: auto;
    }

    main {
      min-width: 0;
      padding: 18px;
      overflow: auto;
    }

    .resource-list {
      display: grid;
      gap: 8px;
      margin-top: 12px;
    }

    .resource-button {
      width: 100%;
      text-align: left;
      display: grid;
      gap: 2px;
      padding: 10px;
      min-height: 58px;
    }

    .resource-button.active {
      border-color: var(--accent);
      box-shadow: inset 3px 0 0 var(--accent);
    }

    .resource-name {
      font-weight: 700;
    }

    .resource-meta {
      color: var(--muted);
      font-size: 12px;
    }

    .toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      margin-bottom: 14px;
    }

    .tabs {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
    }

    .tab {
      background: transparent;
    }

    .tab.active {
      border-color: var(--accent);
      background: #e7f3ef;
      color: var(--accent-dark);
    }

    .grid {
      display: grid;
      grid-template-columns: minmax(0, 1.25fr) minmax(320px, 0.75fr);
      gap: 14px;
      align-items: start;
    }

    .panel {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--panel);
      min-width: 0;
    }

    .panel-head {
      border-bottom: 1px solid var(--line);
      padding: 12px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
    }

    .panel-body {
      padding: 12px;
    }

    .stack {
      display: grid;
      gap: 12px;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }

    .muted {
      color: var(--muted);
    }

    .warning {
      color: var(--warn);
    }

    .error {
      color: var(--danger);
    }

    .code {
      background: var(--code);
      color: var(--code-text);
      border-radius: 6px;
      padding: 12px;
      min-height: 48px;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: 6px;
    }

    table {
      border-collapse: collapse;
      width: 100%;
      min-width: 480px;
      background: #fff;
    }

    th,
    td {
      border-bottom: 1px solid var(--line);
      padding: 8px 10px;
      text-align: left;
      vertical-align: top;
      max-width: 360px;
    }

    th {
      position: sticky;
      top: 0;
      background: var(--panel-soft);
      font-size: 12px;
      color: var(--muted);
    }

    td {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
      font-size: 12px;
      overflow-wrap: anywhere;
    }

    .example {
      display: grid;
      gap: 8px;
      border: 1px solid var(--line);
      border-radius: 8px;
      padding: 10px;
      background: #fff;
    }

    .example-head {
      display: flex;
      justify-content: space-between;
      gap: 8px;
      align-items: center;
    }

    .method {
      border-radius: 4px;
      padding: 2px 6px;
      color: #fff;
      background: #546a7b;
      font-size: 12px;
      font-weight: 700;
    }

    .method.get {
      background: #1f6feb;
    }

    .method.post {
      background: #1f7a68;
    }

    .method.patch,
    .method.put {
      background: #9a5b00;
    }

    .method.delete {
      background: #b3261e;
    }

    .runner-grid {
      display: grid;
      grid-template-columns: auto minmax(180px, 1fr) auto;
      gap: 8px;
      align-items: center;
    }

    .path-input {
      width: 100%;
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      padding: 6px 10px;
    }

    .hidden {
      display: none;
    }

    @media (max-width: 900px) {
      .layout,
      .grid {
        grid-template-columns: 1fr;
      }

      aside {
        border-right: 0;
        border-bottom: 1px solid var(--line);
        max-height: 280px;
      }

      header {
        align-items: flex-start;
        flex-direction: column;
      }

      .status {
        justify-content: flex-start;
      }
    }
  </style>
</head>
<body>
  <div class="app">
    <header>
      <div>
        <h1>jsondb viewer</h1>
        <div class="muted" id="subtitle">Loading local fixture database</div>
      </div>
      <div class="status" id="status"></div>
    </header>
    <div class="layout">
      <aside>
        <div class="toolbar">
          <h2>Resources</h2>
          <button type="button" id="refresh">Refresh</button>
        </div>
        <div id="resource-list" class="resource-list"></div>
      </aside>
      <main>
        <div class="toolbar">
          <div>
            <h2 id="resource-title">Select a resource</h2>
            <div class="muted" id="resource-detail"></div>
          </div>
          <div class="tabs" role="tablist" aria-label="jsondb viewer sections">
            <button type="button" class="tab active" data-tab="data">Data</button>
            <button type="button" class="tab" data-tab="rest">REST</button>
            <button type="button" class="tab" data-tab="graphql">GraphQL</button>
            <button type="button" class="tab" data-tab="schema">Schema</button>
          </div>
        </div>

        <section id="tab-data" class="tab-panel">
          <div class="grid">
            <div class="panel">
              <div class="panel-head">
                <h3>Data</h3>
                <button type="button" id="reload-data">Reload</button>
              </div>
              <div class="panel-body" id="data-view"></div>
            </div>
            <div class="panel">
              <div class="panel-head">
                <h3>Selected JSON</h3>
                <button type="button" data-copy-target="json-output">Copy</button>
              </div>
              <div class="panel-body">
                <pre id="json-output" class="code">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-rest" class="tab-panel hidden">
          <div class="grid">
            <div class="panel">
              <div class="panel-head">
                <h3>REST Specs</h3>
              </div>
              <div class="panel-body stack" id="rest-examples"></div>
            </div>
            <div class="panel">
              <div class="panel-head">
                <h3>REST Runner</h3>
              </div>
              <div class="panel-body stack">
                <div class="runner-grid">
                  <select id="rest-method" aria-label="REST method">
                    <option>GET</option>
                    <option>POST</option>
                    <option>PATCH</option>
                    <option>PUT</option>
                    <option>DELETE</option>
                  </select>
                  <input id="rest-path" class="path-input" aria-label="REST path" value="/">
                  <button type="button" class="primary" id="run-rest">Run</button>
                </div>
                <textarea id="rest-body" aria-label="REST request body">{}</textarea>
                <pre id="rest-output" class="code">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-graphql" class="tab-panel hidden">
          <div class="grid">
            <div class="panel">
              <div class="panel-head">
                <h3>GraphQL Examples</h3>
              </div>
              <div class="panel-body stack" id="graphql-examples"></div>
            </div>
            <div class="panel">
              <div class="panel-head">
                <h3>GraphQL Runner</h3>
                <button type="button" data-copy-target="graphql-query">Copy Query</button>
              </div>
              <div class="panel-body stack">
                <textarea id="graphql-query" aria-label="GraphQL query"></textarea>
                <textarea id="graphql-variables" aria-label="GraphQL variables">{}</textarea>
                <div class="row">
                  <button type="button" class="primary" id="run-graphql">Run GraphQL</button>
                  <button type="button" id="load-sdl">Load SDL</button>
                </div>
                <pre id="graphql-output" class="code">{}</pre>
              </div>
            </div>
          </div>
        </section>

        <section id="tab-schema" class="tab-panel hidden">
          <div class="grid">
            <div class="panel">
              <div class="panel-head">
                <h3>Fields</h3>
              </div>
              <div class="panel-body" id="field-view"></div>
            </div>
            <div class="panel">
              <div class="panel-head">
                <h3>Generated Schema</h3>
                <button type="button" data-copy-target="schema-output">Copy</button>
              </div>
              <div class="panel-body">
                <pre id="schema-output" class="code">{}</pre>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  </div>

  <script>
    const GRAPHQL_PATH = ${JSON.stringify(graphqlPath)};
    const state = {
      schema: null,
      resources: [],
      selected: null,
      selectedData: null,
    };

    const els = {
      subtitle: document.getElementById('subtitle'),
      status: document.getElementById('status'),
      resources: document.getElementById('resource-list'),
      refresh: document.getElementById('refresh'),
      reloadData: document.getElementById('reload-data'),
      resourceTitle: document.getElementById('resource-title'),
      resourceDetail: document.getElementById('resource-detail'),
      dataView: document.getElementById('data-view'),
      jsonOutput: document.getElementById('json-output'),
      restExamples: document.getElementById('rest-examples'),
      restMethod: document.getElementById('rest-method'),
      restPath: document.getElementById('rest-path'),
      restBody: document.getElementById('rest-body'),
      restOutput: document.getElementById('rest-output'),
      graphqlExamples: document.getElementById('graphql-examples'),
      graphqlQuery: document.getElementById('graphql-query'),
      graphqlVariables: document.getElementById('graphql-variables'),
      graphqlOutput: document.getElementById('graphql-output'),
      loadSdl: document.getElementById('load-sdl'),
      fieldView: document.getElementById('field-view'),
      schemaOutput: document.getElementById('schema-output'),
    };

    document.addEventListener('click', async (event) => {
      const copyButton = event.target.closest('[data-copy-target]');
      if (copyButton) {
        await copyText(document.getElementById(copyButton.dataset.copyTarget).textContent);
      }

      const exampleButton = event.target.closest('[data-load-example]');
      if (exampleButton) {
        loadExample(JSON.parse(exampleButton.dataset.loadExample));
      }

      const resourceButton = event.target.closest('[data-resource]');
      if (resourceButton) {
        await selectResource(resourceButton.dataset.resource);
      }
    });

    document.querySelectorAll('[data-tab]').forEach((button) => {
      button.addEventListener('click', () => showTab(button.dataset.tab));
    });

    els.refresh.addEventListener('click', boot);
    els.reloadData.addEventListener('click', () => loadSelectedData());
    document.getElementById('run-rest').addEventListener('click', runRest);
    document.getElementById('run-graphql').addEventListener('click', runGraphql);
    els.loadSdl.addEventListener('click', loadGraphqlSdl);

    boot().catch(showFatal);

    async function boot() {
      state.schema = await fetchJson('/__jsondb/schema');
      state.resources = Object.entries(state.schema.resources || {}).map(([name, resource]) => ({
        name,
        ...resource,
      }));
      renderStatus();
      renderResourceList();
      els.subtitle.textContent = state.resources.length + ' resources loaded';
      if (state.resources.length > 0) {
        await selectResource(state.selected?.name || state.resources[0].name);
      }
    }

    async function selectResource(name) {
      state.selected = state.resources.find((resource) => resource.name === name);
      if (!state.selected) {
        return;
      }

      document.querySelectorAll('[data-resource]').forEach((button) => {
        button.classList.toggle('active', button.dataset.resource === name);
      });

      els.resourceTitle.textContent = state.selected.name;
      els.resourceDetail.textContent = state.selected.kind + ' · ' + state.selected.typeName + routeText(state.selected);
      renderRestExamples();
      renderGraphqlExamples();
      renderFields();
      els.schemaOutput.textContent = pretty(state.selected);
      await loadSelectedData();
    }

    async function loadSelectedData() {
      if (!state.selected) {
        return;
      }

      const response = await fetch(resourcePath(state.selected));
      state.selectedData = await response.json();
      els.jsonOutput.textContent = pretty(state.selectedData);
      renderData();
    }

    function renderStatus() {
      const diagnostics = state.schema.diagnostics || [];
      const errors = diagnostics.filter((item) => item.severity === 'error').length;
      const warnings = diagnostics.filter((item) => item.severity === 'warn').length;
      els.status.innerHTML = '';
      els.status.append(
        pill(state.resources.length + ' resources'),
        pill('REST ready'),
        pill('GraphQL ready'),
        pill(errors + ' errors', errors > 0 ? 'error' : ''),
        pill(warnings + ' warnings', warnings > 0 ? 'warning' : ''),
      );
    }

    function renderResourceList() {
      els.resources.innerHTML = '';
      for (const resource of state.resources) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'resource-button';
        button.dataset.resource = resource.name;
        button.innerHTML = '<span class="resource-name"></span><span class="resource-meta"></span>';
        button.querySelector('.resource-name').textContent = resource.name;
        button.querySelector('.resource-meta').textContent = resource.kind + ' · ' + Object.keys(resource.fields || {}).length + ' fields';
        els.resources.append(button);
      }
    }

    function renderData() {
      const data = state.selectedData;
      if (Array.isArray(data)) {
        els.dataView.innerHTML = renderTable(data);
        return;
      }

      els.dataView.innerHTML = '<pre class="code"></pre>';
      els.dataView.querySelector('pre').textContent = pretty(data);
    }

    function renderTable(records) {
      if (records.length === 0) {
        return '<div class="muted">[]</div>';
      }

      const columns = Array.from(records.reduce((set, record) => {
        Object.keys(record || {}).forEach((key) => set.add(key));
        return set;
      }, new Set()));

      const head = columns.map((column) => '<th>' + escapeHtml(column) + '</th>').join('');
      const rows = records.map((record) => '<tr>' + columns.map((column) => '<td>' + escapeHtml(formatCell(record[column])) + '</td>').join('') + '</tr>').join('');
      return '<div class="table-wrap"><table><thead><tr>' + head + '</tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function renderRestExamples() {
      const examples = restExamplesFor(state.selected);
      els.restExamples.innerHTML = '';
      for (const example of examples) {
        els.restExamples.append(exampleView(example, 'rest'));
      }
      if (examples[0]) {
        loadExample({ kind: 'rest', ...examples[0] });
      }
    }

    function renderGraphqlExamples() {
      const examples = graphqlExamplesFor(state.selected);
      els.graphqlExamples.innerHTML = '';
      for (const example of examples) {
        els.graphqlExamples.append(exampleView(example, 'graphql'));
      }
      if (examples[0]) {
        loadExample({ kind: 'graphql', ...examples[0] });
      }
    }

    function renderFields() {
      const rows = Object.entries(state.selected.fields || {}).map(([name, field]) => {
        return '<tr><td>' + escapeHtml(name) + '</td><td>' + escapeHtml(fieldType(field)) + '</td><td>' + escapeHtml(field.required ? 'yes' : 'no') + '</td><td>' + escapeHtml(field.description || '') + '</td></tr>';
      }).join('');
      els.fieldView.innerHTML = '<div class="table-wrap"><table><thead><tr><th>Field</th><th>Type</th><th>Required</th><th>Description</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    }

    function exampleView(example, kind) {
      const element = document.createElement('div');
      element.className = 'example';
      const copyText = kind === 'rest' ? restCopyText(example) : example.query;
      const payload = JSON.stringify({ kind, ...example });
      element.innerHTML = '<div class="example-head"><div><strong></strong><div class="muted"></div></div><div class="row"><button type="button" data-load-example="">Load</button><button type="button">Copy</button></div></div><pre class="code"></pre>';
      element.querySelector('strong').textContent = example.name;
      element.querySelector('.muted').textContent = kind === 'rest' ? example.method + ' ' + example.path : 'GraphQL';
      element.querySelector('[data-load-example]').dataset.loadExample = payload;
      element.querySelector('.row button:last-child').addEventListener('click', () => copyTextToClipboard(copyText));
      element.querySelector('pre').textContent = copyText;
      return element;
    }

    function loadExample(example) {
      if (example.kind === 'rest') {
        els.restMethod.value = example.method;
        els.restPath.value = example.path;
        els.restBody.value = example.body === undefined ? '{}' : pretty(example.body);
      } else {
        els.graphqlQuery.value = example.query;
        els.graphqlVariables.value = pretty(example.variables || {});
      }
    }

    async function runRest() {
      const method = els.restMethod.value;
      const options = { method, headers: { 'content-type': 'application/json' } };
      if (!['GET', 'DELETE'].includes(method)) {
        options.body = els.restBody.value.trim() || '{}';
      }
      const response = await fetch(els.restPath.value, options);
      const text = await response.text();
      els.restOutput.textContent = response.status + ' ' + response.statusText + '\\n' + formatJsonText(text);
      await loadSelectedData();
    }

    async function runGraphql() {
      const response = await fetch(GRAPHQL_PATH, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: els.graphqlQuery.value,
          variables: parseJson(els.graphqlVariables.value, {}),
        }),
      });
      const json = await response.json();
      els.graphqlOutput.textContent = pretty(json);
      await loadSelectedData();
    }

    async function loadGraphqlSdl() {
      const response = await fetch(GRAPHQL_PATH);
      els.graphqlOutput.textContent = await response.text();
    }

    function restExamplesFor(resource) {
      const path = resourcePath(resource);
      if (resource.kind === 'document') {
        return [
          { name: 'Read document', method: 'GET', path },
          { name: 'Replace document', method: 'PUT', path, body: sampleDocument(resource) },
          { name: 'Patch document', method: 'PATCH', path, body: samplePatch(resource) },
        ];
      }

      const id = sampleId(resource);
      return [
        { name: 'List records', method: 'GET', path },
        { name: 'Read record', method: 'GET', path: path + '/' + encodeURIComponent(id) },
        { name: 'Create record', method: 'POST', path, body: sampleRecord(resource) },
        { name: 'Patch record', method: 'PATCH', path: path + '/' + encodeURIComponent(id), body: samplePatch(resource) },
        { name: 'Delete record', method: 'DELETE', path: path + '/' + encodeURIComponent(id) },
        { name: 'Batch list and schema', method: 'POST', path: '/__jsondb/batch', body: [{ method: 'GET', path }, { method: 'GET', path: '/__jsondb/schema' }] },
      ];
    }

    function graphqlExamplesFor(resource) {
      const fields = selectionFields(resource);
      if (resource.kind === 'document') {
        return [
          { name: 'Read document', query: '{\\n  ' + resource.name + ' {\\n' + fields + '\\n  }\\n}' },
          { name: 'Patch document', query: 'mutation {\\n  update' + resource.typeName + '(patch: ' + inlineObject(samplePatch(resource)) + ') {\\n' + fields + '\\n  }\\n}' },
          { name: 'Set value', query: 'mutation {\\n  set' + resource.typeName + '(path: "/theme", value: "dark") {\\n' + fields + '\\n  }\\n}' },
        ];
      }

      const singular = lowerFirst(resource.typeName);
      return [
        { name: 'List records', query: '{\\n  ' + resource.name + ' {\\n' + fields + '\\n  }\\n}' },
        { name: 'Read record', query: 'query Get' + resource.typeName + '($id: ID!) {\\n  ' + singular + '(id: $id) {\\n' + fields + '\\n  }\\n}', variables: { id: sampleId(resource) } },
        { name: 'Create record', query: 'mutation Create' + resource.typeName + '($input: JSON!) {\\n  create' + resource.typeName + '(input: $input) {\\n' + fields + '\\n  }\\n}', variables: { input: sampleRecord(resource) } },
        { name: 'Patch record', query: 'mutation {\\n  update' + resource.typeName + '(id: "' + sampleId(resource) + '", patch: ' + inlineObject(samplePatch(resource)) + ') {\\n' + fields + '\\n  }\\n}' },
        { name: 'Delete record', query: 'mutation {\\n  delete' + resource.typeName + '(id: "' + sampleId(resource) + '")\\n}' },
      ];
    }

    function sampleRecord(resource) {
      const record = {};
      for (const [name, field] of Object.entries(resource.fields || {})) {
        record[name] = sampleValue(name, field, resource);
      }
      return record;
    }

    function sampleDocument(resource) {
      return sampleRecord(resource);
    }

    function samplePatch(resource) {
      const entries = Object.entries(resource.fields || {}).filter(([name]) => name !== resource.idField);
      if (entries.length === 0) {
        return {};
      }
      const [name, field] = entries[0];
      return { [name]: sampleValue(name, field, resource) };
    }

    function sampleValue(name, field, resource) {
      if (name === resource.idField) {
        return sampleId(resource);
      }
      if ('default' in field) {
        return field.default;
      }
      if (field.type === 'enum') {
        return (field.values || [])[0] || 'value';
      }
      if (field.type === 'number') {
        return 1;
      }
      if (field.type === 'boolean') {
        return true;
      }
      if (field.type === 'array') {
        return [];
      }
      if (field.type === 'object') {
        return {};
      }
      return sampleString(name);
    }

    function sampleString(name) {
      if (name.toLowerCase().includes('email')) {
        return 'user@example.com';
      }
      if (name.toLowerCase().endsWith('at')) {
        return new Date().toISOString();
      }
      return name + '-value';
    }

    function sampleId(resource) {
      const data = state.selected?.name === resource.name ? state.selectedData : null;
      if (Array.isArray(data) && data[0] && data[0][resource.idField] !== undefined) {
        return data[0][resource.idField];
      }
      return resource.name + '_1';
    }

    function selectionFields(resource) {
      const fieldNames = Object.keys(resource.fields || {}).slice(0, 6);
      if (fieldNames.length === 0) {
        return '    __typename';
      }
      return fieldNames.map((name) => '    ' + name).join('\\n');
    }

    function resourcePath(resource) {
      return resource.routePath || '/' + resource.name;
    }

    function routeText(resource) {
      return ' · ' + resourcePath(resource);
    }

    function restCopyText(example) {
      const lines = [example.method + ' ' + example.path];
      if (example.body !== undefined) {
        lines.push('', pretty(example.body));
      }
      return lines.join('\\n');
    }

    function showTab(name) {
      document.querySelectorAll('[data-tab]').forEach((button) => {
        button.classList.toggle('active', button.dataset.tab === name);
      });
      document.querySelectorAll('.tab-panel').forEach((panel) => {
        panel.classList.toggle('hidden', panel.id !== 'tab-' + name);
      });
    }

    function fieldType(field) {
      if (field.type === 'enum') {
        return 'enum(' + (field.values || []).join(', ') + ')';
      }
      if (field.type === 'array') {
        return 'array<' + fieldType(field.items || { type: 'unknown' }) + '>';
      }
      return field.type || 'unknown';
    }

    function inlineObject(value) {
      return JSON.stringify(value).replace(/"([^"]+)":/g, '$1:');
    }

    function lowerFirst(value) {
      return value.charAt(0).toLowerCase() + value.slice(1);
    }

    function parseJson(text, fallback) {
      try {
        return text.trim() ? JSON.parse(text) : fallback;
      } catch (error) {
        return fallback;
      }
    }

    function formatJsonText(text) {
      try {
        return pretty(JSON.parse(text));
      } catch {
        return text;
      }
    }

    function formatCell(value) {
      if (value === null || value === undefined) {
        return '';
      }
      if (typeof value === 'object') {
        return JSON.stringify(value);
      }
      return String(value);
    }

    function pretty(value) {
      return JSON.stringify(value, null, 2);
    }

    function pill(text, className) {
      const element = document.createElement('span');
      element.className = 'pill ' + (className || '');
      element.textContent = text;
      return element;
    }

    async function fetchJson(path) {
      const response = await fetch(path);
      if (!response.ok) {
        throw new Error('Request failed: ' + response.status + ' ' + path);
      }
      return response.json();
    }

    async function copyText(text) {
      await copyTextToClipboard(text);
    }

    async function copyTextToClipboard(text) {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    }

    function escapeHtml(value) {
      return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
    }

    function showFatal(error) {
      els.subtitle.textContent = 'Unable to load jsondb viewer';
      els.dataView.innerHTML = '<pre class="code"></pre>';
      els.dataView.querySelector('pre').textContent = error.stack || error.message;
    }
  </script>
</body>
</html>`;
}
