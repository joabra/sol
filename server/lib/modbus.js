// Lokal Modbus TCP-styrning via WiNet-S-dongeln.
// Snabbare (~50 ms) och internetoberoende jämfört med moln-API:t.
//
// Holding-register (0-baserade adresser, verifierade mot WiNet-S):
//   13049 EMS-läge: 0=självkonsumtion, 2=forcerat, 4=VPP
//   13050 Kommando: 0xAA(170)=ladda, 0xBB(187)=urladda, 0xCC(204)=stopp
//   13051 Effekt (W)
// Input-register (läsning):
//   13023 Batteri-SOC (0,1 %) — 0-baserad adress 13022
import ModbusRTU from 'modbus-serial';
import { loadSettings } from './config.js';

const REG = {
  EMS_MODE: 13049,  // 0-baserad adress verifierad mot denna WiNet-S/firmware
  COMMAND: 13050,
  POWER: 13051,
};
const CMD = { CHARGE: 0xaa, DISCHARGE: 0xbb, STOP: 0xcc };

export function isConfigured() {
  return Boolean(loadSettings().modbus?.host);
}

async function withClient(fn) {
  const cfg = loadSettings().modbus || {};
  if (!cfg.host) throw new Error('NOT_CONFIGURED');
  const client = new ModbusRTU();
  client.setTimeout(5000);
  try {
    await client.connectTCP(cfg.host, { port: cfg.port || 502 });
    client.setID(cfg.unitId || 1);
    return await fn(client);
  } finally {
    try { client.close(() => {}); } catch {}
  }
}

export async function test() {
  return withClient(async (client) => {
    // Läs SOC (input-register 13023, 0-baserat 13022) som anslutningstest
    const soc = await client.readInputRegisters(13022, 1);
    return { ok: true, batterySocPct: soc.data[0] / 10 };
  });
}

export async function readStatus() {
  return withClient(async (client) => {
    const [soc, ems] = [
      await client.readInputRegisters(13022, 1),
      await client.readHoldingRegisters(REG.EMS_MODE, 3),
    ];
    return {
      batterySocPct: soc.data[0] / 10,
      emsMode: ems.data[0],
      command: ems.data[1],
      powerW: ems.data[2],
    };
  });
}

async function writeVerified(client, values) {
  // WiNet-S kan tyst ignorera skrivningar (skrivskyddad firmware) — verifiera med återläsning
  await client.writeRegisters(REG.EMS_MODE, values);
  await new Promise((r) => setTimeout(r, 1500));
  const back = await client.readHoldingRegisters(REG.EMS_MODE, 3);
  const ok = back.data[0] === values[0] && back.data[1] === values[1] && back.data[2] === values[2];
  if (!ok) {
    throw new Error(
      'WiNet-S accepterade inte skrivningen (registren oförändrade). Din firmware tillåter troligen bara läsning via Modbus — använd molnstyrning, eller uppdatera WiNet-S-firmware.'
    );
  }
}

export async function forceCharge(_uuid, powerW) {
  return withClient(async (client) => {
    await writeVerified(client, [2, CMD.CHARGE, Math.round(powerW)]);
    return { local: true, cmd: 'charge', powerW };
  });
}

export async function forceDischarge(_uuid, powerW) {
  return withClient(async (client) => {
    await writeVerified(client, [2, CMD.DISCHARGE, Math.round(powerW)]);
    return { local: true, cmd: 'discharge', powerW };
  });
}

export async function stopForced() {
  return withClient(async (client) => {
    await writeVerified(client, [0, CMD.STOP, 0]);
    return { local: true, cmd: 'stop' };
  });
}
