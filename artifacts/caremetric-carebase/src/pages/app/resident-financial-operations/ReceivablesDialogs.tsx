import { useState } from "react";
import {
  useCreateResidentRateAgreement,
  useGenerateResidentFinancialStatement,
  usePostResidentFinancialTransaction,
  usePostResidentMonthlyCharges,
  type FinancialWorkspace,
} from "@/hooks/useResidentFinancialOperations";
import { useToast } from "@/hooks/use-toast";
import { addFacilityCalendarDays, facilityToday } from "@/lib/dateUtils";
import type { MonthlyChargePreview } from "@/lib/residentBilling";
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
import { asNumber, human, money, monthStart, today, useReport } from "./helpers";
import { Choice, Field } from "./primitives";

export function RateDialog({
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
  const mutation = useCreateResidentRateAgreement();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    effective: today(),
    through: "",
    base: "",
    care: "",
    room: "",
    deposit: "",
    community: "",
    ancillary: "",
    proration: "daily_actual",
    leave: "",
    refund: "",
    amendment: "",
    notes: "",
    agreementVersion: "none",
  });
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        terms: {
          effectiveFrom: form.effective,
          effectiveThrough: form.through || null,
          baseMonthlyCharge: asNumber(form.base),
          levelOfCareCharge: asNumber(form.care),
          roomRate: asNumber(form.room),
          depositAmount: asNumber(form.deposit),
          communityFee: asNumber(form.community),
          ancillaryServices: form.ancillary
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean)
            .map((item) => {
              const [name, amount] = item.split(":");
              return { name: name.trim(), amount: asNumber(amount) };
            }),
          prorationMethod: form.proration,
          leaveOfAbsenceTerms: form.leave,
          dischargeRefundTerms: form.refund,
          amendmentReason: form.amendment,
          notes: form.notes,
          residentAgreementVersionId:
            form.agreementVersion === "none" ? null : form.agreementVersion,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data.rates.length
              ? "Add rate amendment"
              : "Create resident rate agreement"}
          </DialogTitle>
          <DialogDescription>
            Financial terms are versioned independently and may link to the
            signed resident contract or fee schedule.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Effective from">
            <Input
              type="date"
              value={form.effective}
              onChange={(e) => setForm({ ...form, effective: e.target.value })}
            />
          </Field>
          <Field label="Effective through">
            <Input
              type="date"
              value={form.through}
              onChange={(e) => setForm({ ...form, through: e.target.value })}
            />
          </Field>
          <Field label="Base monthly charge">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.base}
              onChange={(e) => setForm({ ...form, base: e.target.value })}
            />
          </Field>
          <Field label="Level-of-care charge">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.care}
              onChange={(e) => setForm({ ...form, care: e.target.value })}
            />
          </Field>
          <Field label="Room rate">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.room}
              onChange={(e) => setForm({ ...form, room: e.target.value })}
            />
          </Field>
          <Field label="Deposit">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.deposit}
              onChange={(e) => setForm({ ...form, deposit: e.target.value })}
            />
          </Field>
          <Field label="Community fee">
            <Input
              type="number"
              min="0"
              step="0.01"
              value={form.community}
              onChange={(e) => setForm({ ...form, community: e.target.value })}
            />
          </Field>
          <Field label="Proration">
            <Choice
              value={form.proration}
              onChange={(value) => setForm({ ...form, proration: value })}
              values={["daily_actual", "daily_30", "no_proration", "custom"]}
            />
          </Field>
          <Field label="Ancillary services" span>
            <Input
              value={form.ancillary}
              onChange={(e) => setForm({ ...form, ancillary: e.target.value })}
              placeholder="Escort:25, Laundry:40"
            />
          </Field>
          <Field label="Linked signed agreement" span>
            <Choice
              value={form.agreementVersion}
              onChange={(value) =>
                setForm({ ...form, agreementVersion: value })
              }
              values={[
                { value: "none", label: "No linked agreement" },
                ...data.agreementVersions
                  .filter((item) => item.current_version_id)
                  .map((item) => ({
                    value: item.current_version_id!,
                    label: `${item.title} · ${item.current_version?.version_label ?? "current"}`,
                  })),
              ]}
            />
          </Field>
          <Field label="Leave-of-absence adjustments" span>
            <Textarea
              value={form.leave}
              onChange={(e) => setForm({ ...form, leave: e.target.value })}
            />
          </Field>
          <Field label="Discharge refund terms" span>
            <Textarea
              value={form.refund}
              onChange={(e) => setForm({ ...form, refund: e.target.value })}
            />
          </Field>
          {data.rates.length > 0 && (
            <Field label="Amendment reason" span>
              <Textarea
                value={form.amendment}
                onChange={(e) =>
                  setForm({ ...form, amendment: e.target.value })
                }
              />
            </Field>
          )}
          <Field label="Notes" span>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              !form.effective ||
              (data.rates.length > 0 && form.amendment.trim().length < 5)
            }
            onClick={submit}
          >
            Save immutable rate version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
export function EntryDialog({
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
  const mutation = usePostResidentFinancialTransaction();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    kind: "charge",
    side: "debit",
    category: "base_monthly",
    amount: "",
    effective: today(),
    start: "",
    end: "",
    method: "",
    reference: "",
    memo: "",
    target: "none",
    reason: "",
    receipt: "none",
  });
  const kind = (value: string) =>
    setForm({
      ...form,
      kind: value,
      side:
        value === "charge"
          ? "debit"
          : value === "adjustment"
            ? form.side
            : "credit",
      category:
        value === "payment"
          ? "payment"
          : value === "adjustment"
            ? "adjustment"
            : form.category,
    });
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        entry: {
          transactionKind: form.kind,
          entrySide: form.side,
          category: form.category,
          amount: asNumber(form.amount),
          effectiveOn: form.effective,
          servicePeriodStart: form.start || null,
          servicePeriodEnd: form.end || null,
          paymentMethod: form.method,
          paymentReference: form.reference,
          memo: form.memo,
          adjustsTransactionId: form.target === "none" ? null : form.target,
          adjustmentReason: form.reason,
          receiptDocumentId: form.receipt === "none" ? null : form.receipt,
        },
      },
      report,
    );
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post resident receivable entry</DialogTitle>
          <DialogDescription>
            Use a linked adjustment to correct prior financial entries; original
            transactions cannot be edited.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Entry type">
            <Choice
              value={form.kind}
              onChange={kind}
              values={["charge", "payment", "credit", "refund", "adjustment"]}
            />
          </Field>
          {form.kind === "adjustment" && (
            <Field label="Debit or credit">
              <Choice
                value={form.side}
                onChange={(value) => setForm({ ...form, side: value })}
                values={["debit", "credit"]}
              />
            </Field>
          )}
          <Field label="Category">
            <Choice
              value={form.category}
              onChange={(value) => setForm({ ...form, category: value })}
              values={[
                "base_monthly",
                "level_of_care",
                "ancillary_service",
                "room_rate",
                "deposit",
                "community_fee",
                "proration",
                "leave_of_absence",
                "discharge_refund",
                "payment",
                "adjustment",
                "other",
              ]}
            />
          </Field>
          <Field label="Amount">
            <Input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(e) => setForm({ ...form, amount: e.target.value })}
            />
          </Field>
          <Field label="Effective date">
            <Input
              type="date"
              value={form.effective}
              onChange={(e) => setForm({ ...form, effective: e.target.value })}
            />
          </Field>
          <Field label="Service period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Service period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Payment method">
            <Input
              value={form.method}
              onChange={(e) => setForm({ ...form, method: e.target.value })}
            />
          </Field>
          <Field label="Payment reference">
            <Input
              value={form.reference}
              onChange={(e) => setForm({ ...form, reference: e.target.value })}
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
          {form.kind === "adjustment" && (
            <>
              <Field label="Corrects transaction" span>
                <Choice
                  value={form.target}
                  onChange={(value) => setForm({ ...form, target: value })}
                  values={[
                    { value: "none", label: "Select prior transaction" },
                    ...data.transactions.map((item) => ({
                      value: item.id,
                      label: `${item.effective_on} · ${human(item.category)} · ${money(item.amount)}`,
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
          <Field label="Memo" span>
            <Textarea
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
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
              asNumber(form.amount) <= 0 ||
              form.memo.trim().length < 3 ||
              (form.kind === "adjustment" &&
                (form.target === "none" || form.reason.trim().length < 5))
            }
            onClick={submit}
          >
            Post immutable entry
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MonthlyChargesDialog({
  open,
  onClose,
  residentId,
  charges,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
  charges: MonthlyChargePreview[];
}) {
  const mutation = usePostResidentMonthlyCharges();
  const { toast } = useToast();
  const [form, setForm] = useState({
    start: monthStart(),
    end: today(),
    memo: "Monthly billing run",
  });
  const total = charges.reduce((sum, charge) => sum + charge.amount, 0);
  const submit = () =>
    mutation.mutate(
      {
        residentId,
        periodStart: form.start,
        periodEnd: form.end,
        memo: form.memo,
        charges,
      },
      {
        onSuccess: () => {
          toast({
            title: "Monthly charges posted",
            description: `${charges.length} charge(s) totaling ${money(total)} were posted atomically.`,
          });
          onClose();
        },
        onError: (error: Error) =>
          toast({
            title: "Could not post monthly charges",
            description: error.message,
            variant: "destructive" as const,
          }),
      },
    );

  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Post monthly recurring charges</DialogTitle>
          <DialogDescription>
            Review the current rate agreement charges before posting them as
            immutable receivable ledger entries.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Service period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Service period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Batch memo" span>
            <Input
              value={form.memo}
              onChange={(e) => setForm({ ...form, memo: e.target.value })}
            />
          </Field>
        </div>
        <div className="space-y-2 rounded border p-3">
          {charges.map((charge) => (
            <div
              key={`${charge.category}-${charge.label}`}
              className="flex items-center justify-between text-sm"
            >
              <span>{charge.label}</span>
              <strong>{money(charge.amount)}</strong>
            </div>
          ))}
          <div className="flex items-center justify-between border-t pt-2">
            <span>Total</span>
            <strong>{money(total)}</strong>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending ||
              !charges.length ||
              form.end < form.start ||
              form.memo.trim().length < 3
            }
            onClick={submit}
          >
            Post {charges.length} charge(s)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StatementDialog({
  open,
  onClose,
  residentId,
}: {
  open: boolean;
  onClose: () => void;
  residentId: string;
}) {
  const mutation = useGenerateResidentFinancialStatement();
  const report = useReport(onClose);
  const [form, setForm] = useState({
    start: monthStart(),
    end: today(),
    due: addFacilityCalendarDays(facilityToday(), 15),
  });
  return (
    <Dialog open={open} onOpenChange={(value) => !value && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate resident statement</DialogTitle>
          <DialogDescription>
            The statement captures an immutable transaction snapshot and creates
            follow-up work for carried delinquency.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Period start">
            <Input
              type="date"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.target.value })}
            />
          </Field>
          <Field label="Period end">
            <Input
              type="date"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.target.value })}
            />
          </Field>
          <Field label="Due date">
            <Input
              type="date"
              value={form.due}
              onChange={(e) => setForm({ ...form, due: e.target.value })}
            />
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={
              mutation.isPending || form.end < form.start || form.due < today()
            }
            onClick={() =>
              mutation.mutate(
                {
                  residentId,
                  periodStart: form.start,
                  periodEnd: form.end,
                  dueDate: form.due,
                },
                report,
              )
            }
          >
            Generate statement
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
