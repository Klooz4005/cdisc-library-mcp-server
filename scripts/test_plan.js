#!/usr/bin/env node
import { spawn } from 'child_process';

function encode(obj) { return JSON.stringify(obj) + "\n"; }

async function runPlan() {
  const env = { ...process.env };
  if (!env.CDISC_API_KEY) {
    console.error('Missing CDISC_API_KEY');
    process.exit(2);
  }
  const child = spawn(process.execPath, ['server/index.js'], { env });
  child.stderr.on('data', (d) => process.stderr.write(d));

  let nextId = 1;
  const send = (method, params = {}) => {
    const id = nextId++;
    child.stdin.write(encode({ jsonrpc: '2.0', id, method, params }));
    return id;
  };

  const req = (method, params = {}) => send(method, params);
  const callTool = (name, args = {}) => req('tools/call', { name, arguments: args });

  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    for (const line of chunk.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      try {
        const msg = JSON.parse(t);
        if ('id' in msg) {
          console.log('Response', msg.id, (JSON.stringify(msg).slice(0, 600)));
        } else if (msg.method) {
          console.log('Notification', msg.method);
        }
      } catch {}
    }
  });

  // initialize and list tools
  req('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-plan', version: '0.0.1' } });
  req('tools/list', {});

  // 0) Auth header vs query
  // header (default) → BC packages
  callTool('call_operation', { operationId: 'get_biomedicalconcept_packages_mdr_bc_packages_get' });
  // query auth → BC packages
  setTimeout(() => {
    child.kill('SIGTERM');
    const envQuery = { ...env, CDISC_AUTH_LOCATION: 'query' };
    const child2 = spawn(process.execPath, ['server/index.js'], { env: envQuery });
    child2.stderr.on('data', (d) => process.stderr.write(d));
    child2.stdout.setEncoding('utf8');
    child2.stdout.on('data', (data) => process.stdout.write(data));
    // init
    child2.stdin.write(encode({ jsonrpc: '2.0', id: 100, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-plan', version: '0.0.1' } } }));
    child2.stdin.write(encode({ jsonrpc: '2.0', id: 101, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_biomedicalconcept_packages_mdr_bc_packages_get' } } }));

    // 0b) Missing API key should 401
    setTimeout(() => {
      const envMissing = { ...env };
      delete envMissing.CDISC_API_KEY;
      const child3 = spawn(process.execPath, ['server/index.js'], { env: envMissing });
      child3.stderr.on('data', (d) => process.stderr.write(d));
      child3.stdout.setEncoding('utf8');
      child3.stdout.on('data', (data) => process.stdout.write(data));
      child3.stdin.write(encode({ jsonrpc: '2.0', id: 200, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test-plan', version: '0.0.1' } } }));
      child3.stdin.write(encode({ jsonrpc: '2.0', id: 201, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_biomedicalconcept_packages_mdr_bc_packages_get' } } }));
      setTimeout(() => { try { child3.kill(); } catch {} }, 1500);
    }, 500);

    // 1) Suggest and search
    setTimeout(() => {
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 102, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'api-search-suggest', query: { q: 'pulse' }, headers: { accept: 'application/xml' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 103, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'api-search-search', query: { q: 'vital', pageSize: 5, facets: true }, headers: { accept: 'text/csv' } } } }));

      // 2) BC latest + by id + package flows
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 104, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_biomedical_concepts_mdr_bc_biomedicalconcepts_get', query: { category: 'Measurement' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 105, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_biomedicalconcept_mdr_bc_biomedicalconcepts__biomedicalconcept__g', pathParams: { biomedicalconcept: 'C49676' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 106, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_biomedicalconcept_packages_mdr_bc_packages_get' } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 107, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_biomedicalconcepts_mdr_bc_packages__package__biomedicalconcepts_get', pathParams: { package: '2022-10-26' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 108, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_package_biomedicalconcept_mdr_bc_packages__package__biomedicalconcepts__', pathParams: { package: '2022-10-26', biomedicalconcept: 'C49676' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 109, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_biomedicalconcept_categories_mdr_bc_categories_get' } } }));

      // 3) SDTM latest + by id + packages + domains + BC anchored
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 110, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_sdtm_specializations_mdr_specializations_sdtm_datasetspecializati', query: { domain: 'LB' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 111, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_sdtm_specialization_mdr_specializations_sdtm_datasetspecializatio', pathParams: { dataset_specialization_id: 'SYSBP' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 112, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_sdtm_specialization_packages_mdr_specializations_sdtm_packages_get' } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 113, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_sdtm_specializations_mdr_specializations_sdtm_packages__package__dataset', pathParams: { package: '2022-10-26' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 114, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_sdtm_specialization_mdr_specializations_sdtm_packages__package__datasets', pathParams: { package: '2022-10-26', datasetspecialization: 'SYSBP' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 115, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_sdtm_dataset_specialization_domain_list_mdr_specializations_sdtm_domains' } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 116, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_bc_datasetspecializations_mdr_specializations_datasetspecializati', query: { biomedicalconcept: 'C25298' } } } }));

      // 4) End-to-end golden path: pulse → concept → specializations → detail
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 117, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'api-search-search', query: { q: 'pulse', pageSize: 1 } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 118, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_biomedicalconcept_mdr_bc_biomedicalconcepts__biomedicalconcept__g', pathParams: { biomedicalconcept: 'C49676' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 119, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_bc_datasetspecializations_mdr_specializations_datasetspecializati', query: { biomedicalconcept: 'C49676' } } } }));
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 120, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_sdtm_specialization_mdr_specializations_sdtm_datasetspecializatio', pathParams: { dataset_specialization_id: 'SYSBP' } } } }));

      // 5) Error/validation: invalid specialization id → expect error
      child2.stdin.write(encode({ jsonrpc: '2.0', id: 121, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId: 'get_latest_sdtm_specialization_mdr_specializations_sdtm_datasetspecializatio', pathParams: { dataset_specialization_id: 'NOPE' } } } }));

      setTimeout(() => { try { child2.kill(); } catch {} }, 9000);
    }, 1500);
  }, 1200);
}

runPlan().catch((e) => { console.error(e); process.exit(1); });


