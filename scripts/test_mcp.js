#!/usr/bin/env node
// Minimal MCP stdio client to smoke-test our server against the real API
// Uses newline-delimited JSON per @modelcontextprotocol/sdk stdio transport

import { spawn } from 'child_process';

function encodeMessage(obj) {
  return Buffer.from(JSON.stringify(obj) + "\n", 'utf8');
}

function decodeStream(onMessage) {
  let buffer = '';
  return (chunk) => {
    buffer += chunk.toString('utf8');
    let idx;
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line) continue;
      try { onMessage(JSON.parse(line)); } catch (e) { console.error('Invalid JSON:', e, line); }
    }
  };
}

function sendInitialize(child, id = 1) {
  const msg = {
    jsonrpc: '2.0',
    id,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'local-test', version: '0.0.1' }
    }
  };
  child.stdin.write(encodeMessage(msg));
}

function sendToolsList(child, id = 2) {
  child.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method: 'tools/list', params: {} }));
}

function sendListOperations(child, id = 3, filter) {
  child.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'list_operations', arguments: filter ? { filter } : {} } }));
}

function sendCallOperation(child, id = 4, operationId, args = {}) {
  child.stdin.write(encodeMessage({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: 'call_operation', arguments: { operationId, ...args } } }));
}

async function main() {
  const env = { ...process.env };
  if (!env.CDISC_API_KEY) {
    console.error('CDISC_API_KEY is not set in environment');
    process.exit(2);
  }

  console.log('Starting server...');
  const child = spawn(process.execPath, ['server/index.js'], { env });
  child.on('exit', (code) => console.log('Server exited with code', code));
  child.stderr.on('data', (d) => process.stderr.write(d));

  const onMessage = decodeStream((msg) => {
    if (msg.id !== undefined) {
      console.log('Response', msg.id, JSON.stringify(msg).slice(0, 500));
    } else if (msg.method) {
      console.log('Notification', msg.method);
    }
  });
  child.stdout.on('data', onMessage);

  // Sequence: initialize -> tools/list -> list_operations -> call_operation (packages list)
  sendInitialize(child, 1);
  setTimeout(() => sendToolsList(child, 2), 300);
  setTimeout(() => sendListOperations(child, 3, 'packages'), 600);
  // Known simple GET op with no params from BC spec
  setTimeout(() => sendCallOperation(child, 4, 'get_biomedicalconcept_packages_mdr_bc_packages_get'), 1200);
  // SDTM packages
  setTimeout(() => sendCallOperation(child, 5, 'get_sdtm_specialization_packages_mdr_specializations_sdtm_packages_get'), 1600);
  // SDTM specializations for known package
  setTimeout(() => sendCallOperation(child, 6, 'get_sdtm_specializations_mdr_specializations_sdtm_packages__package__dataset', { pathParams: { package: '2022-10-26' } }), 2000);
  // SDTM specialization detail (package + datasetspecialization)
  setTimeout(() => sendCallOperation(child, 7, 'get_sdtm_specialization_mdr_specializations_sdtm_packages__package__datasets', { pathParams: { package: '2022-10-26', datasetspecialization: 'SYSBP' } }), 2400);
  // Latest SDTM specialization list (no params)
  setTimeout(() => sendCallOperation(child, 8, 'get_latest_sdtm_specializations_mdr_specializations_sdtm_datasetspecializati'), 2800);
  // Latest SDTM specialization by id
  setTimeout(() => sendCallOperation(child, 9, 'get_latest_sdtm_specialization_mdr_specializations_sdtm_datasetspecializatio', { pathParams: { dataset_specialization_id: 'SYSBP' } }), 3200);
  // Latest Biomedical Concept by id
  setTimeout(() => sendCallOperation(child, 10, 'get_latest_biomedicalconcept_mdr_bc_biomedicalconcepts__biomedicalconcept__g', { pathParams: { biomedicalconcept: 'C49676' } }), 3600);
  // Biomedical Concept list (no params)
  setTimeout(() => sendCallOperation(child, 11, 'get_latest_biomedical_concepts_mdr_bc_biomedicalconcepts_get'), 4000);

  // Exit after a short delay
  setTimeout(() => {
    try { child.kill(); } catch {}
    process.exit(0);
  }, 9000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


