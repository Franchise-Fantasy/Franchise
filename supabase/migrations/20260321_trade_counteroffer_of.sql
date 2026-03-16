ALTER TABLE trade_proposals
  ADD COLUMN counteroffer_of uuid REFERENCES trade_proposals(id);
