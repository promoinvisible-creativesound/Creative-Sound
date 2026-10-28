// Who a producer addresses an invoice to when they invoice their earnings to
// Creative Sound, and where invoices are sent. Shown in the producer area, on
// the monthly statement (PDF and CSV) and mentioned in the sale email.
//
// Creative Sound is the brand name: the business is not registered with the
// chamber of commerce, so invoices are addressed to the person who holds the
// VAT number.
module.exports = {
  tradeName: 'Creative Sound',
  legalName: 'Emanuele Paparella',
  address: 'Via G. Manzù 36, 00013 Mentana (RM), Italy',
  vat: '17024071007',
  pec: 'emanuelepaparella65@pec.it',
  // With a PEC address the electronic invoice (SDI) code is the neutral 0000000.
  sdiCode: '0000000',
  invoiceEmail: 'hello@creativesound.io',
};
