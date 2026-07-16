// Väljer styrväg: lokal Modbus (WiNet-S) om konfigurerad, annars moln-API (paramSetting).
import { loadSettings } from './config.js';
import * as sungrow from './sungrow.js';
import * as modbus from './modbus.js';
import * as mock from './mock.js';

function useModbus() {
  const m = loadSettings().modbus || {};
  return Boolean(m.host && m.preferForControl !== false);
}

async function cloudInverterUuid(api, settings) {
  const psId = settings.sungrow.psId || (await api.getPowerStationList())[0]?.ps_id;
  const devices = await api.getDeviceList(psId);
  const inverter = devices.find((d) => d.device_type === 14) || devices[0];
  if (!inverter?.uuid) throw new Error('Ingen växelriktare med uuid hittad');
  return inverter.uuid;
}

async function run(cmd, powerW) {
  const settings = loadSettings();
  if (useModbus()) {
    const result = cmd === 'charge'
      ? await modbus.forceCharge(null, powerW)
      : cmd === 'discharge'
        ? await modbus.forceDischarge(null, powerW)
        : await modbus.stopForced();
    return { via: 'modbus', result };
  }
  const api = sungrow.isConfigured() ? sungrow : mock;
  const uuid = await cloudInverterUuid(api, settings);
  const result = cmd === 'charge'
    ? await api.forceCharge(uuid, powerW, settings.optimizer.maxSocPercent)
    : cmd === 'discharge'
      ? await api.forceDischarge(uuid, powerW)
      : await api.stopForced(uuid);
  return { via: sungrow.isConfigured() ? 'cloud' : 'mock', result };
}

export const charge = (powerW) => run('charge', powerW);
export const discharge = (powerW) => run('discharge', powerW);
export const stop = () => run('stop', 0);
