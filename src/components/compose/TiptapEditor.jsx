import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Link, Link2Off
} from 'lucide-react'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import UnderlineExt from '@tiptap/extension-underline'
import LinkExt from '@tiptap/extension-link'
import { useCallback } from 'react'

const TiptapButton = ({ onClick, isActive, children, title }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    className={`p-1.5 rounded hover:bg-muted hover:text-foreground transition-colors ${
      isActive ? 'bg-muted text-foreground' : 'text-muted-foreground'
    }`}
  >
    {children}
  </button>
)

const EditorToolbar = ({ editor }) => {
  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href
    const url = window.prompt('URL', previousUrl)

    if (url === null) return // cancelled
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }, [editor])

  if (!editor) return null

  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border p-2">
      <TiptapButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive('bold')}
        title="Bold"
      >
        <Bold className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive('italic')}
        title="Italic"
      >
        <Italic className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        isActive={editor.isActive('underline')}
        title="Underline"
      >
        <Underline className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive('strike')}
        title="Strikethrough"
      >
        <Strikethrough className="w-4 h-4" />
      </TiptapButton>
      <div className="w-px h-5 bg-border mx-1" />
      <TiptapButton
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        isActive={editor.isActive('bulletList')}
        title="Bullet List"
      >
        <List className="w-4 h-4" />
      </TiptapButton>
      <TiptapButton
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        isActive={editor.isActive('orderedList')}
        title="Ordered List"
      >
        <ListOrdered className="w-4 h-4" />
      </TiptapButton>
      <div className="w-px h-5 bg-border mx-1" />
      <TiptapButton onClick={setLink} isActive={editor.isActive('link')} title="Add Link">
        <Link className="w-4 h-4" />
      </TiptapButton>
      {editor.isActive('link') && (
        <TiptapButton
          onClick={() => editor.chain().focus().unsetLink().run()}
          title="Remove Link"
        >
          <Link2Off className="w-4 h-4" />
        </TiptapButton>
      )}
    </div>
  )
}

export const TiptapEditor = ({ value, onChange, placeholder }) => {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
      }),
      UnderlineExt,
      LinkExt.configure({
        openOnClick: false,
        autolink: true,
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML())
    },
    editorProps: {
      attributes: {
        class: 'outline-none w-full h-full text-sm text-foreground leading-relaxed',
      },
    },
  })

  return (
    <div className="flex flex-col h-full">
      <EditorToolbar editor={editor} />
      {/* Clicking anywhere in this area focuses the editor */}
      <div
        className="flex-1 overflow-y-auto cursor-text"
        onClick={() => editor?.chain().focus().run()}
      >
        <EditorContent editor={editor} className="h-full [&_.ProseMirror]:p-3 [&_.ProseMirror]:min-h-full [&_.ProseMirror]:outline-none" />
      </div>
    </div>
  )
}
