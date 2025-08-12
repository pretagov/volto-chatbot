import { selectedSidebarChatbot } from "#stores/sidebarStore";
import ChatWindow from "@eeacms/volto-chatbot/ChatBlock/ChatWindow";
import { useStore } from "@nanostores/react";
import Icon from "@plone/volto/components/theme/Icon/Icon";
import { Button } from "semantic-ui-react";

// ChatBlock
import { getBlocksFieldname } from "@plone/volto/helpers";
import clearSVG from "@plone/volto/icons/clear.svg";
import { forwardRef, Fragment } from "react";
import superagent from "superagent";
import withDanswerData from "../../ChatBlock/withDanswerData";

import config from "@plone/registry";

const ChatBlockDisplay = withDanswerData(({ assistant }) => [
  "assistantData",
  typeof assistant !== "undefined" && assistant !== null
    ? superagent.get(`/_da/persona/${assistant}`).type("json")
    : null,
  assistant,
])(function ChatBlockDisplay({ data, assistantData }) {
  if (!assistantData) {
    return null;
  }
  return <ChatWindow persona={assistantData} {...data} />;
});

function SideContent() {
  const sources = [
    {
      document_id: "https://www.bathnes.gov.uk/paying-your-council-tax",
      chunk_ind: 1,
      semantic_identifier:
        "Paying your Council Tax | Bath and North East Somerset Council",
      link: "https://www.bathnes.gov.uk/paying-your-council-tax",
      blurb:
        "Pay online\nTo pay online, you will need a debit or credit card and your Council Tax account number. During the process, you will manually enter the amount you wish to pay. Please note that some banks and building societies may take a few days to deduct your payment from your account balance. \nPayment can be made using most credit and debit cards. Unfortunately we are not able to accept American Express.\n",
      source_type: "web",
      boost: 0,
      hidden: false,
      metadata: {},
      score: 0.8034438652901195,
      is_relevant: null,
      relevance_explanation: null,
      match_highlights: [
        "",
        "56 00 34\n- Account Number: 57134510\n! Warning You must quote your <hi>Council</hi> <hi>Tax</hi> account number as the <hi>payment</hi> reference, or we may not be able to process your <hi>payment</hi>. If you are making <hi>payments</hi> to multiple <hi>Council</hi> <hi>Tax</hi> accounts, to ensure we allocate <hi>payments</hi> correctly, please send a remittance advice to...",
      ],
      updated_at: "2025-02-13T15:16:00Z",
      primary_owners: null,
      secondary_owners: null,
      is_internet: false,
      db_doc_id: 19373,
      index: "2",
    },
    {
      document_id:
        "https://www.bathnes.gov.uk/missed-payment-or-struggling-pay-your-council-tax",
      chunk_ind: 2,
      semantic_identifier:
        "Missed a payment or struggling to pay your Council Tax | Bath and North East Somerset Council",
      link: "https://www.bathnes.gov.uk/missed-payment-or-struggling-pay-your-council-tax",
      blurb:
        "To set up a Direct Debit, visit [Paying your Council Tax](/paying-your-council-tax) .\nIf you're unable to make the payment you have missed, please contact us as soon as possible.\nReminder Notice\nWe issue a Reminder Notice when our records show that you have not paid the latest instalment on your Council Tax bill. You have 14 days to pay the amount shown on the notice. ",
      source_type: "web",
      boost: 0,
      hidden: false,
      metadata: {},
      score: 0.7599835944883082,
      is_relevant: null,
      relevance_explanation: null,
      match_highlights: [
        "",
        "your future instalments by [Direct Debit](/paying-your-<hi>council</hi>-<hi>tax</hi>) , to avoid missing any future <hi>payments</hi>.\nLegally, we can send you a Reminder Notice for a missed <hi>Council</hi> <hi>Tax</hi> <hi>payment</hi> on two separate occasions in one financial year (start of April to the end of March). If you miss a <hi>payment</hi> for a third time, we will issue a Final...",
      ],
      updated_at: "2025-05-15T07:54:00Z",
      primary_owners: null,
      secondary_owners: null,
      is_internet: false,
      db_doc_id: 19374,
      index: "3",
    },
  ];
  return (
    <ul role="list" className="all-sources-display">
      {sources.map((source, index) => {
        return (
          <li key={index} className="">
            <a href={source.link}>
              <h2>{source.semantic_identifier}</h2>
            </a>
            <p dangerouslySetInnerHTML={{ __html: source.blurb }}></p>
          </li>
        );
      })}
    </ul>
  );
}

export const SidebarDisplay = forwardRef(function SidebarDisplay(
  { content },
  ref,
) {
  const $selectedSidebarChatbot = useStore(selectedSidebarChatbot);

  const blocksFieldname = getBlocksFieldname(content) || "blocks";

  const sidebarBlockData = Object.values(content?.[blocksFieldname] || {}).find(
    (block) =>
      block["@type"] === "danswerChat" &&
      block.assistant == $selectedSidebarChatbot,
  );
  const sidebarTitle =
    sidebarBlockData?.starterPromptsHeading ||
    config.settings["volto-chatbot"]?.sidebar?.sidebarTitle ||
    "Help using this site";

  const sideContent = true;

  return (
    <>
      <div id="chatbot-sidebar">
        <dialog
          aria-modal="true"
          id="chatbot-sidebar-dialog"
          aria-labelledby="dialog_heading"
          ref={ref}
        >
          <div className="dialog-content">
            <div className="dialog-main">
              <div className="heading">
                <Button
                  type="button"
                  basic
                  aria-label={"Close"}
                  onClick={() => {
                    selectedSidebarChatbot.set(null);
                  }}
                >
                  <Icon circled name={clearSVG} size="48px" />
                </Button>
                <h2 id="dialog_heading">{sidebarTitle}</h2>
              </div>
              <ChatBlockDisplay
                assistant={$selectedSidebarChatbot}
                data={sidebarBlockData}
              />
            </div>
            {sideContent ? (
              <div className="dialog-side">
                <div className="dialog-side__wrapper">
                  <SideContent />
                </div>
              </div>
            ) : null}
          </div>
        </dialog>
      </div>
    </>
  );
});
