import { Card, Input, Typography } from "antd";

const { Paragraph, Title } = Typography;
const { TextArea } = Input;

interface PromptsViewProps {
  currentPromptText: string;
  onChangePromptText: (text: string) => void;
}

export default function PromptsView({ currentPromptText, onChangePromptText }: PromptsViewProps) {
  const lineCount = currentPromptText ? currentPromptText.split(/\r?\n/).length : 0;
  const charCount = currentPromptText.length;

  return (
    <div className="app-prompts-page h-full">
      <Card className="app-panel-strong app-prompts-card h-full" bodyStyle={{ padding: 22, height: "100%" }}>
        <div className="app-prompts-toolbar">
          <div>
            <Title level={4} className="app-title !mb-1">
              系统提示词编辑器
            </Title>
            <Paragraph className="app-muted !mb-0">
              用于约束助手行为。建议写清角色、边界、工具调用策略和输出风格。
            </Paragraph>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="app-chip">行数 {lineCount}</span>
            <span className="app-chip">字符 {charCount}</span>
          </div>
        </div>

        <div className="app-prompts-editor-wrap">
          <TextArea
            id="system-prompt-editor"
            value={currentPromptText}
            onChange={(event) => onChangePromptText(event.target.value)}
            autoSize={false}
            spellCheck={false}
            placeholder="输入系统提示词..."
            aria-label="系统提示词编辑器"
            className="app-code-editor app-input app-prompts-editor"
          />
        </div>
      </Card>
    </div>
  );
}
