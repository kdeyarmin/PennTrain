import { useEffect, useRef, useState } from "react";

/** An earlier send may finish after the user starts another reply or opens another ticket. */
export function useSupportReplyDraft(ticketId: string | undefined) {
  const [reply, setReplyValue] = useState("");
  const [file, setFileValue] = useState<File | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    revision.current++;
    setReplyValue("");
    setFileValue(null);
    return () => { revision.current++; };
  }, [ticketId]);
  const setReply = (value: string) => { revision.current++; setReplyValue(value); };
  const setFile = (value: File | null) => { revision.current++; setFileValue(value); };
  const onSubmitted = () => {
    const submittedRevision = revision.current;
    return () => {
      if (revision.current !== submittedRevision) return;
      revision.current++;
      setReplyValue("");
      setFileValue(null);
    };
  };
  return { reply, setReply, file, setFile, onSubmitted };
}
