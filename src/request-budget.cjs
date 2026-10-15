'use strict';

class RequestBudget {
  constructor(limit = 8) {
    this.limit = Math.max(1, Math.min(Number(limit) || 8, 30));
    this.used = 0;
  }
  consume() {
    if (this.used >= this.limit) {
      throw Error(`Limite de ${this.limit} solicitações por envio atingido. Revise o resultado antes de continuar.`);
    }
    return { used: ++this.used, remaining: this.limit - this.used };
  }
}

class DailyUsageTracker {
  constructor(initialData = {}) {
    this.data = initialData || {};
  }
  todayKey() {
    return new Date().toISOString().slice(0, 10);
  }
  record({ model = 'gemini', requests = 1, inputTokens = 0, outputTokens = 0 }) {
    const key = this.todayKey();
    if (!this.data[key]) {
      this.data[key] = { requests: 0, models: {}, inputTokens: 0, outputTokens: 0 };
    }
    const day = this.data[key];
    day.requests += requests;
    day.inputTokens += inputTokens;
    day.outputTokens += outputTokens;
    day.models[model] = (day.models[model] || 0) + requests;
    return day;
  }
  getToday() {
    const key = this.todayKey();
    return this.data[key] || { requests: 0, models: {}, inputTokens: 0, outputTokens: 0 };
  }
  toJSON() {
    return this.data;
  }
}

module.exports = { RequestBudget, DailyUsageTracker };
