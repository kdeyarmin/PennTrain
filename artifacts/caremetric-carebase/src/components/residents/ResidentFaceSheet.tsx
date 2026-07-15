import type { ResidentFaceSheetPacket } from "@/lib/residentFaceSheet";

function FieldGrid({ fields }: { fields: { label: string; value: string }[] }) {
  return (
    <div className="mb-4 grid grid-cols-3 gap-2 text-xs">
      {fields.map((field) => (
        <div key={field.label} className="border border-black p-2">
          <span className="font-semibold">{field.label}:</span> {field.value}
        </div>
      ))}
    </div>
  );
}

export function ResidentFaceSheet({ packet }: { packet: ResidentFaceSheetPacket }) {
  return (
    <div className="hidden print:block text-black">
      <div className="mb-4 flex items-start justify-between border-b border-black pb-2">
        <div>
          <h2 className="text-xl font-bold">Resident Face Sheet</h2>
          <p className="text-sm">{packet.title}</p>
        </div>
        <div className="text-right text-xs">
          <p>Printed {packet.generatedAt}</p>
          <p>Transfer / appointment reference</p>
        </div>
      </div>

      <FieldGrid fields={packet.demographics} />

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <section className="border border-black p-2">
          <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Clinical & Professional Contacts</h3>
          {packet.contacts.map((contact) => (
            <p key={contact.label}><span className="font-semibold">{contact.label}:</span> {contact.value}</p>
          ))}
        </section>
        <section className="border border-black p-2">
          <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Informal Supports / Emergency Contacts</h3>
          {!packet.supports.length ? (
            <p>None on file.</p>
          ) : packet.supports.map((support, idx) => (
            <p key={`${support.name}-${support.relationship}-${support.phone}-${idx}`}>
              <span className="font-semibold">{support.name}</span> · {support.relationship} · {support.phone}
            </p>
          ))}
        </section>
      </div>

      <section className="mb-4 border border-black p-2 text-xs">
        <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Residential-Care Profile</h3>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1">
          {packet.careProfile.map((item) => (
            <p key={item.label}><span className="font-semibold">{item.label}:</span> {item.value}</p>
          ))}
        </div>
      </section>

      <div className="mb-4 grid grid-cols-2 gap-3 text-xs">
        <section className="border border-black p-2">
          <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Legal / Directive Readiness</h3>
          {packet.legalReadiness.map((item, index) => (
            <p key={`${item.label}-${index}`}><span className="font-semibold">{item.label}:</span> {item.value}</p>
          ))}
        </section>
        <section className="border border-black p-2">
          <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Property Inventory</h3>
          {packet.propertyInventory.length ? packet.propertyInventory.map((item, index) => (
            <p key={`${item.item}-${index}`}><span className="font-semibold">{item.item}:</span> {item.details}</p>
          )) : <p>No property recorded.</p>}
        </section>
      </div>

      <section className="mb-4 border border-black p-2 text-xs">
        <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Admission / Transfer / Leave History</h3>
        {packet.lifecycle.length ? packet.lifecycle.map((item, index) => (
          <p key={`${item.event}-${item.date}-${index}`}><span className="font-semibold">{item.date} · {item.event}:</span> {item.reason}</p>
        )) : <p>No lifecycle events recorded.</p>}
      </section>

      <section className="mb-4 border border-black p-2 text-xs">
        <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Current Resident Compliance / Transfer Form Readiness</h3>
        {!packet.complianceItems.length ? (
          <p>No compliance items recorded.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="border border-black p-1 text-left">Item</th>
                <th className="border border-black p-1 text-left">Status</th>
                <th className="border border-black p-1 text-left">Due</th>
                <th className="border border-black p-1 text-left">Completed</th>
              </tr>
            </thead>
            <tbody>
              {packet.complianceItems.map((item) => (
                <tr key={`${item.label}-${item.dueDate}-${item.completedDate}`}>
                  <td className="border border-black p-1">{item.label}</td>
                  <td className="border border-black p-1">{item.status}</td>
                  <td className="border border-black p-1">{item.dueDate}</td>
                  <td className="border border-black p-1">{item.completedDate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="border border-black p-2 text-xs">
        <h3 className="mb-2 border-b border-black pb-1 text-sm font-bold">Available Documents to Send</h3>
        {!packet.documents.length ? (
          <p>No resident documents uploaded.</p>
        ) : (
          <ul className="list-disc pl-4">
            {packet.documents.map((document) => (
              <li key={`${document.fileName}-${document.label}`}>{document.fileName}{document.label !== "—" ? ` · ${document.label}` : ""}{document.isStateForm ? " (state form)" : ""}</li>
            ))}
          </ul>
        )}
      </section>

      <p className="mt-4 border-t border-black pt-2 text-[10px]">{packet.sourceNote}</p>
    </div>
  );
}
