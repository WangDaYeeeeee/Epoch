ALTER TABLE normalized_ledger_event
  DROP CONSTRAINT normalized_ledger_event_action_check;

ALTER TABLE normalized_ledger_event
  ADD CONSTRAINT normalized_ledger_event_action_check CHECK (action IN (
    'buy', 'sell', 'deposit', 'withdrawal', 'dividend', 'fee', 'interest',
    'tax', 'transfer_in', 'transfer_out', 'fx_buy', 'fx_sell',
    'adjustment_in', 'adjustment_out', 'other'
  ));
