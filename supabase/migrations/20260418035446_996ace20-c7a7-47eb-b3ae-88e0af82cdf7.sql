
-- Add owner-fallback RLS policies so rows with NULL organization_id remain accessible to their owner.
-- These supplement (not replace) the existing org-based policies.

-- Helper macro pattern: for each user-owned table create 4 policies (SELECT/INSERT/UPDATE/DELETE)
-- gated on auth.uid() = user_id AND organization_id IS NULL.

-- companies
CREATE POLICY "Owner fallback select companies" ON public.companies FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert companies" ON public.companies FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update companies" ON public.companies FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete companies" ON public.companies FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- income_entries
CREATE POLICY "Owner fallback select income_entries" ON public.income_entries FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert income_entries" ON public.income_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update income_entries" ON public.income_entries FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete income_entries" ON public.income_entries FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- income_forecasts
CREATE POLICY "Owner fallback select income_forecasts" ON public.income_forecasts FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert income_forecasts" ON public.income_forecasts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update income_forecasts" ON public.income_forecasts FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete income_forecasts" ON public.income_forecasts FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- mileage_entries
CREATE POLICY "Owner fallback select mileage_entries" ON public.mileage_entries FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert mileage_entries" ON public.mileage_entries FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update mileage_entries" ON public.mileage_entries FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete mileage_entries" ON public.mileage_entries FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- plaid_accounts
CREATE POLICY "Owner fallback select plaid_accounts" ON public.plaid_accounts FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert plaid_accounts" ON public.plaid_accounts FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update plaid_accounts" ON public.plaid_accounts FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete plaid_accounts" ON public.plaid_accounts FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- plaid_items (note: SELECT is already restricted to auth.uid() = user_id from prior migration)
CREATE POLICY "Owner fallback insert plaid_items" ON public.plaid_items FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update plaid_items" ON public.plaid_items FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete plaid_items" ON public.plaid_items FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- plaid_transactions
CREATE POLICY "Owner fallback select plaid_transactions" ON public.plaid_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert plaid_transactions" ON public.plaid_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update plaid_transactions" ON public.plaid_transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete plaid_transactions" ON public.plaid_transactions FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- projected_bonus_events
CREATE POLICY "Owner fallback select projected_bonus_events" ON public.projected_bonus_events FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert projected_bonus_events" ON public.projected_bonus_events FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update projected_bonus_events" ON public.projected_bonus_events FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete projected_bonus_events" ON public.projected_bonus_events FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- projected_income_overrides
CREATE POLICY "Owner fallback select projected_income_overrides" ON public.projected_income_overrides FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert projected_income_overrides" ON public.projected_income_overrides FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update projected_income_overrides" ON public.projected_income_overrides FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete projected_income_overrides" ON public.projected_income_overrides FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- projected_income_streams
CREATE POLICY "Owner fallback select projected_income_streams" ON public.projected_income_streams FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert projected_income_streams" ON public.projected_income_streams FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update projected_income_streams" ON public.projected_income_streams FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete projected_income_streams" ON public.projected_income_streams FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- retirement_contributions
CREATE POLICY "Owner fallback select retirement_contributions" ON public.retirement_contributions FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert retirement_contributions" ON public.retirement_contributions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update retirement_contributions" ON public.retirement_contributions FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete retirement_contributions" ON public.retirement_contributions FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- stock_transactions
CREATE POLICY "Owner fallback select stock_transactions" ON public.stock_transactions FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert stock_transactions" ON public.stock_transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update stock_transactions" ON public.stock_transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete stock_transactions" ON public.stock_transactions FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- tax_payments
CREATE POLICY "Owner fallback select tax_payments" ON public.tax_payments FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert tax_payments" ON public.tax_payments FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update tax_payments" ON public.tax_payments FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete tax_payments" ON public.tax_payments FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- tax_savings
CREATE POLICY "Owner fallback select tax_savings" ON public.tax_savings FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert tax_savings" ON public.tax_savings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update tax_savings" ON public.tax_savings FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete tax_savings" ON public.tax_savings FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- tax_settings
CREATE POLICY "Owner fallback select tax_settings" ON public.tax_settings FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert tax_settings" ON public.tax_settings FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update tax_settings" ON public.tax_settings FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- transactions
CREATE POLICY "Owner fallback select transactions" ON public.transactions FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert transactions" ON public.transactions FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update transactions" ON public.transactions FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete transactions" ON public.transactions FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- transaction_links
CREATE POLICY "Owner fallback select transaction_links" ON public.transaction_links FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert transaction_links" ON public.transaction_links FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback update transaction_links" ON public.transaction_links FOR UPDATE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete transaction_links" ON public.transaction_links FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);

-- transaction_match_ignores
CREATE POLICY "Owner fallback select transaction_match_ignores" ON public.transaction_match_ignores FOR SELECT TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback insert transaction_match_ignores" ON public.transaction_match_ignores FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id AND organization_id IS NULL);
CREATE POLICY "Owner fallback delete transaction_match_ignores" ON public.transaction_match_ignores FOR DELETE TO authenticated USING (auth.uid() = user_id AND organization_id IS NULL);
