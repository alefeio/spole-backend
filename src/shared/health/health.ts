export type HealthState = {
  postgresOk: boolean;
  redisOk: boolean;
};

const state: HealthState = {
  postgresOk: false,
  redisOk: false
};

export function resetHealth() {
  state.postgresOk = false;
  state.redisOk = false;
}

export function setPostgresHealthy(ok: boolean) {
  state.postgresOk = ok;
}

export function setRedisHealthy(ok: boolean) {
  state.redisOk = ok;
}

export function isHealthy(): boolean {
  return state.postgresOk && state.redisOk;
}

export function getHealthSnapshot(): HealthState {
  return { ...state };
}
