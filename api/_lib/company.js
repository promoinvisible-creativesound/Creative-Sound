// Who a producer addresses an invoice to when they invoice their earnings to
// Creative Sound, and where invoices are sent. Shown in the producer area, on
// the monthly statement (PDF and CSV) and mentioned in the sale email.
module.exports = {
  tradeName: 'Creative Sound',
  legalName: 'Emanuele Paparella',
  address: 'Via G. Manzù 36, Mentana (RM), Italy',
  vat: '17024071007',
  pec: 'emanuelepaparella65@pec.it',
  // With a PEC address the electronic invoice (SDI) code is the neutral 0000000.
  sdiCode: '0000000',
  invoiceEmail: 'hello@creativesound.io',
};
