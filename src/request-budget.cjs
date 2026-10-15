'use strict';
class RequestBudget {
  constructor(limit=8){this.limit=limit;this.used=0;}
  consume(){if(this.used>=this.limit)throw Error(`Limite de ${this.limit} solicitações por envio atingido. Revise o resultado antes de continuar.`);return{used:++this.used,remaining:this.limit-this.used};}
}
module.exports={RequestBudget};
