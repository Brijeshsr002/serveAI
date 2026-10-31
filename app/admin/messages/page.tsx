import { MessageEditor } from "@/components/message-editor";
import { PageHeader } from "@/components/ui-kit";
import { getSettings } from "@/lib/settings";

export default async function MessagesPage() {
  const values = await getSettings();
  return (
    <>
      <PageHeader title="Customer Messages" subtitle="What the customer is told on WhatsApp at each step. Edit the words, or switch a step off." />
      <MessageEditor values={values} />
    </>
  );
}
