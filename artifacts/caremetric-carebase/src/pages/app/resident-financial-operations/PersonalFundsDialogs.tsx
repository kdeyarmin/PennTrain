import { useEffect, useState } from "react";
import {
  useOpenResidentPersonalFundAccount,
  usePostResidentPersonalFundTransaction,
  useReconcileResidentPersonalFunds,
  useUpsertResidentPersonalFundPayeeProfile,
  type FinancialWorkspace,
} from "@/hooks/useResidentFinancialOperations";
import { facilityDateTimeLocalToUtcIso, toFacilityDateTimeLocal } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { asNumber, money, today, useReport } from "./helpers";
import { Choice, Field } from "./primitives";

export function PayeeDialog({
  open,
  onClose,
  residentId,
  data,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  data: FinancialWorkspace;
}) {
  const mutation = useUpsertResidentPersonalFundPayeeProfile();
  const report = useReport(onClose);
  const profile = data.payeeProfile;
  const [form, setForm] = useState({
    facilityPayee: String(profile?.facility_is_representative_payee ?? false),
    status: profile?.payee_authority_status ?? "not_applicable",
    benefitSource: profile?.benefit_source ?? "",
    benefitAmount: String(profile?.benefit_amount ?? ""),
    pna: String(profile?.personal_needs_allowance ?? ""),
    threshold: String(profile?.resource_alert_threshold ?? 2000),
    bankName: profile?.collective_account_name ?? "",
    bankLast4: profile?.collective_account_last4 ?? "",
    interestBearing: String(profile?.interest_bearing ?? true),
    interestMethod: profile?.interest_allocation_method ?? "pro_rata_balance",
    cadence: profile?.statement_cadence ?? "monthly",
    residentAccess: String(profile?.resident_can_request_funds ?? true),
    disclosure: profile?.disclosure_provided_on ?? "",
    review: profile?.next_review_on ?? "",
    externalName: profile?.external_payee_name ?? "",
    externalContact: profile?.external_payee_contact ?? "",
    notes: profile?.notes ?? "",
  });
  useEffect(() => {
    if (open)
      setForm({
        facilityPayee: String(
          profile?.facility_is_representative_payee ?? false,
        ),
        status: profile?.payee_authority_status ?? "not_applicable",
        benefitSource: profile?.benefit_source ?? "",
        benefitAmount: String(profile?.benefit_amount ?? ""),
        pna: String(profile?.personal_needs_allowance ?? ""),
        threshold: String(profile?.resource_alert_threshold ?? 2000),
        bankName: profile?.collective_account_name ?? "",
        bankLast4: profile?.collective_account_last4 ?? "",
        interestBearing: String(profile?.interest_bearing ?? true),
        interestMethod:
          profile?.interest_allocation_method ?? "pro_rata_balance",
        cadence: profile?.statement_cadence ?? "monthly",
        residentAccess: String(profile?.resident_can_request_funds ?? true),
        disclosure: profile?.disclosure_provided_on ?? "",
        review: profile?.next_review_on ?? "",
        externalName: profile?.external_payee_name ?? "",
        externalContact: profile?.external_payee_contact ?? "",
        notes: profile?.notes ?? "",
      });
  }, [open, profile]);
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        profile: {
          facilityIsRepresentativePayee: form.facilityPayee === "true",
          payeeAuthorityStatus: form.status,
          benefitSource: form.benefitSource,
          benefitAmount: form.benefitAmount || null,
          personalNeedsAllowance: form.pna || null,
          resourceAlertThreshold: form.threshold.trim()
            ? asNumber(form.threshold)
            : null,
          collectiveAccountName: form.bankName,
          collectiveAccountLast4: form.bankLast4,
          interestBearing: form.interestBearing === "true",
          interestAllocationMethod: form.interestMethod,
          statementCadence: form.cadence,
          residentCanRequestFunds: form.residentAccess === "true",
          disclosureProvidedOn: form.disclosure || null,
          nextReviewOn: form.review || null,
          externalPayeeName: form.externalName,
          externalPayeeContact: form.externalContact,
          notes: form.notes,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Representative payee controls</DialogTitle>
          <DialogDescription>
            Track whether the facility is SSA representative payee, how benefits
            and personal needs allowance are safeguarded, and when
            disclosures/reviews are due.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Facility is representative payee">
            <Choice
              value={form.facilityPayee}
              onChange={(value) => setForm({ ...form, facilityPayee: value })}
              values={[
                { value: "false", label: "No" },
                { value: "true", label: "Yes" },
              ]}
            />
          </Field>
          <Field label="Authority status">
            <Choice
              value={form.status}
              onChange={(value) => setForm({ ...form, status: value })}
              values={[
                "not_applicable",
                "application_pending",
                "approved",
                "declined",
                "terminated",
                "external_payee",
              ]}
            />
          </Field>
          <Field label="Benefit source">
            <Input
              value={form.benefitSource}
              onChange={(e) =>
                setForm({ ...form, benefitSource: e.target.value })
              }
              placeholder="SSA retirement, SSI, VA"
            />
          </Field>
          <Field label="Monthly benefit amount">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.benefitAmount}
              onChange={(e) =>
                setForm({ ...form, benefitAmount: e.target.value })
              }
            />
          </Field>
          <Field label="Personal needs allowance">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.pna}
              onChange={(e) => setForm({ ...form, pna: e.target.value })}
            />
          </Field>
          <Field label="Resource alert threshold">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.threshold}
              onChange={(e) => setForm({ ...form, threshold: e.target.value })}
            />
          </Field>
          <Field label="Collective account name">
            <Input
              value={form.bankName}
              onChange={(e) => setForm({ ...form, bankName: e.target.value })}
            />
          </Field>
          <Field label="Bank last 4">
            <Input
              maxLength={4}
              value={form.bankLast4}
              onChange={(e) =>
                setForm({
                  ...form,
                  bankLast4: e.target.value.replace(/\D/g, ""),
                })
              }
            />
          </Field>
          <Field label="Interest bearing">
            <Choice
              value={form.interestBearing}
              onChange={(value) => setForm({ ...form, interestBearing: value })}
              values={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
            />
          </Field>
          <Field label="Interest allocation">
            <Choice
              value={form.interestMethod}
              onChange={(value) => setForm({ ...form, interestMethod: value })}
              values={[
                "pro_rata_balance",
                "direct_account_interest",
                "not_applicable",
              ]}
            />
          </Field>
          <Field label="Statement cadence">
            <Choice
              value={form.cadence}
              onChange={(value) => setForm({ ...form, cadence: value })}
              values={["monthly", "quarterly", "on_request"]}
            />
          </Field>
          <Field label="Resident may request funds">
            <Choice
              value={form.residentAccess}
              onChange={(value) => setForm({ ...form, residentAccess: value })}
              values={[
                { value: "true", label: "Yes" },
                { value: "false", label: "No" },
              ]}
            />
          </Field>
          <Field label="Disclosure provided on">
            <Input
              type="date"
              value={form.disclosure}
              onChange={(e) => setForm({ ...form, disclosure: e.target.value })}
            />
          </Field>
          <Field label="Next authority review">
            <Input
              type="date"
              value={form.review}
              onChange={(e) => setForm({ ...form, review: e.target.value })}
            />
          </Field>
          <Field label="External payee name">
            <Input
              value={form.externalName}
              onChange={(e) =>
                setForm({ ...form, externalName: e.target.value })
              }
            />
          </Field>
          <Field label="External payee contact">
            <Input
              value={form.externalContact}
              onChange={(e) =>
                setForm({ ...form, externalContact: e.target.value })
              }
            />
          </Field>
          <Field label="Notes / safeguards" span>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Resident preference, how funds are requested, disclosure details, family/guardian communication."
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.threshold) < 0 ||
              (!!form.bankLast4 && form.bankLast4.length !== 4)
            }
            onClick={submit}
          >
            Save payee controls
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FundOpenDialog({
  open,
  onClose,
  residentId,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
}) {
  const mutation = useOpenResidentPersonalFundAccount();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    opened: today(),
    balance: "0",
    acknowledged: true,
    note: "",
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Open resident personal-funds account</DialogTitle>
          <DialogDescription>
            The beginning balance becomes the first immutable ledger entry.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Opened on">
            <Input
              type="date"
              value={form.opened}
              onChange={(e) => setForm({ ...form, opened: e.target.value })}
            />
          </Field>
          <Field label="Beginning balance">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.balance}
              onChange={(e) => setForm({ ...form, balance: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.acknowledged}
              onChange={(e) =>
                setForm({ ...form, acknowledged: e.target.checked })
              }
            />
            Resident acknowledged beginning balance
          </label>
          {!form.acknowledged && (
            <Field label="Acknowledgement note" span>
              <Textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              (!form.acknowledged && form.note.trim().length < 5)
            }
            onClick={() =>
              mutation.mutate(
                {
                  residentId,
                  openedOn: form.opened,
                  beginningBalance: asNumber(form.balance),
                  residentAcknowledged: form.acknowledged,
                  acknowledgementNote: form.note,
                },
                report,
              )
            }
          >
            Open account
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function FundEntryDialog({
  open,
  onClose,
  residentId,
  data,
  employees,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  data: FinancialWorkspace;
  employees: Array<{ id: string; first_name: string; last_name: string }>;
}) {
  const mutation = usePostResidentPersonalFundTransaction();
  const report = useReport(onClose);
  const emptyForm = () => ({
    kind: "deposit",
    direction: "in",
    amount: "",
    purpose: "",
    at: toFacilityDateTimeLocal(),
    staff: "none",
    receipt: "none",
    acknowledged: true,
    note: "",
    target: "none",
    reason: "",
  });
  const [form, setForm] = useState(emptyForm);
  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);
  const kind = (value: string) =>
    setForm({
      ...form,
      kind: value,
      direction:
        value === "deposit"
          ? "in"
          : value === "withdrawal"
            ? "out"
            : form.direction,
    });
  const submit = () => {
    if (!form.at || Number.isNaN(new Date(form.at).getTime())) return;
    mutation.mutate(
      {
        residentId,
        entry: {
          transactionKind: form.kind,
          direction: form.direction,
          amount: asNumber(form.amount),
          purpose: form.purpose,
          transactionAt: facilityDateTimeLocalToUtcIso(form.at),
          staffEmployeeId: form.staff === "none" ? null : form.staff,
          receiptDocumentId: form.receipt === "none" ? null : form.receipt,
          residentAcknowledged: form.acknowledged,
          residentAcknowledgedAt: form.acknowledged
            ? new Date().toISOString()
            : null,
          acknowledgementNote: form.note,
          adjustsTransactionId: form.target === "none" ? null : form.target,
          adjustmentReason: form.reason,
        },
      },
      report,
    );
  };
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post personal-funds transaction</DialogTitle>
          <DialogDescription>
            Withdrawals require staff documentation. Corrections must be linked
            adjustments, and balances cannot go below zero.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Transaction type">
            <Choice
              value={form.kind}
              onChange={kind}
              values={["deposit", "withdrawal", "adjustment"]}
            />
          </Field>
          {form.kind === "adjustment" && (
            <Field label="Direction">
              <Choice
                value={form.direction}
                onChange={(value) => setForm({ ...form, direction: value })}
                values={["in", "out"]}
              />
            </Field>
          )}
          <Field label="Amount">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Date and time">
            <Input
              type="datetime-local"
              value={form.at}
              onChange={(e) => setForm({ ...form, at: e.target.value })}
            />
          </Field>
          <Field label="Staff person">
            <Choice
              value={form.staff}
              onChange={(value) => setForm({ ...form, staff: value })}
              values={[
                { value: "none", label: "No staff selected" },
                ...employees.map((item) => ({
                  value: item.id,
                  label: `${item.first_name} ${item.last_name}`,
                })),
              ]}
            />
          </Field>
          <Field label="Receipt document">
            <Choice
              value={form.receipt}
              onChange={(value) => setForm({ ...form, receipt: value })}
              values={[
                { value: "none", label: "No receipt linked" },
                ...data.documents.map((item) => ({
                  value: item.id,
                  label: item.document_label ?? item.file_name,
                })),
              ]}
            />
          </Field>
          <Field label="Purpose" span>
            <Textarea
              value={form.purpose}
              onChange={(e) => setForm({ ...form, purpose: e.target.value })}
            />
          </Field>
          <label className="flex items-center gap-2 text-sm sm:col-span-2">
            <input
              type="checkbox"
              checked={form.acknowledged}
              onChange={(e) =>
                setForm({ ...form, acknowledged: e.target.checked })
              }
            />
            Resident acknowledged this transaction
          </label>
          {!form.acknowledged && (
            <Field label="Why acknowledgement is unavailable" span>
              <Textarea
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
              />
            </Field>
          )}
          {form.kind === "adjustment" && (
            <>
              <Field label="Corrects transaction" span>
                <Choice
                  value={form.target}
                  onChange={(value) => setForm({ ...form, target: value })}
                  values={[
                    { value: "none", label: "Select prior funds transaction" },
                    ...data.fundTransactions.map((item) => ({
                      value: item.id,
                      label: `${new Date(item.transaction_at).toLocaleDateString()} · ${item.purpose} · ${money(item.amount)}`,
                    })),
                  ]}
                />
              </Field>
              <Field label="Adjustment reason" span>
                <Textarea
                  value={form.reason}
                  onChange={(e) => setForm({ ...form, reason: e.target.value })}
                />
              </Field>
            </>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.amount) <= 0 ||
              !form.at ||
              Number.isNaN(new Date(form.at).getTime()) ||
              form.purpose.trim().length < 3 ||
              (form.kind === "withdrawal" && form.staff === "none") ||
              (!form.acknowledged && form.note.trim().length < 5) ||
              (form.kind === "adjustment" &&
                (form.target === "none" || form.reason.trim().length < 5))
            }
            onClick={submit}
          >
            Post funds entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function ReconcileDialog({
  open,
  onClose,
  residentId,
  balance,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  balance: number;
}) {
  const mutation = useReconcileResidentPersonalFunds();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    end: today(),
    counted: String(balance),
    notes: "",
  });
  const variance = asNumber(form.counted) - balance;
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reconcile resident personal funds</DialogTitle>
          <DialogDescription>
            Compare the physical or external statement balance to the immutable
            ledger balance of {money(balance)}.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Counted balance">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.counted}
              onChange={(e) => setForm({ ...form, counted: e.target.value })}
            />
          </Field>
          <Field
            label={`Notes${variance !== 0 ? " (required for variance)" : ""}`}
            span
          >
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </Field>
          <p className="sm:col-span-2 text-sm">
            Calculated variance: <strong>{money(variance)}</strong>
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              asNumber(form.counted) < 0 ||
              (variance !== 0 && form.notes.trim().length < 5)
            }
            onClick={() =>
              mutation.mutate(
                {
                  residentId,
                  periodEnd: form.end,
                  countedBalance: asNumber(form.counted),
                  notes: form.notes,
                },
                report,
              )
            }
          >
            Record reconciliation
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
