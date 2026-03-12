import { createContext, useContext, useState, useCallback } from 'react'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'

const ConfirmContext = createContext(null)

export function useConfirm() {
  const context = useContext(ConfirmContext)
  if (!context) {
    throw new Error('useConfirm must be used within a ConfirmProvider')
  }
  return context
}

export function ConfirmProvider({ children }) {
  const [dialog, setDialog] = useState(null)

  const confirm = useCallback((options) => {
    return new Promise((resolve) => {
      setDialog({
        title: options.title || 'Confirm Action',
        message: options.message || 'Are you sure you want to proceed?',
        confirmText: options.confirmText || 'Confirm',
        cancelText: options.cancelText || 'Cancel',
        variant: options.variant || 'default', // 'default' | 'danger'
        onConfirm: () => {
          setDialog(null)
          resolve(true)
        },
        onCancel: () => {
          setDialog(null)
          resolve(false)
        },
      })
    })
  }, [])

  const confirmDelete = useCallback((itemName) => {
    return confirm({
      title: 'Delete',
      message: `Are you sure you want to delete "${itemName}"? This action cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
    })
  }, [confirm])

  const value = {
    confirm,
    confirmDelete,
    dialog,
    setDialog,
  }

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {dialog && <ConfirmDialog {...dialog} />}
    </ConfirmContext.Provider>
  )
}

function ConfirmDialog({ title, message, confirmText, cancelText, variant, onConfirm, onCancel }) {
  const variantStyles = {
    default: {
      button: 'bg-indigo-600 hover:bg-indigo-500 text-white',
      icon: null,
    },
    danger: {
      button: 'bg-red-600 hover:bg-red-500 text-white',
      icon: AlertTriangle,
    },
  }

  const styles = variantStyles[variant] || variantStyles.default
  const Icon = styles.icon

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onCancel}
        aria-hidden="true"
      />

      {/* Dialog */}
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl shadow-black/50 p-6 max-w-md w-full mx-4 animate-in fade-in zoom-in-95"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-message"
      >
        {Icon && (
          <div className="flex items-start gap-4 mb-4">
            <div className="p-3 bg-red-500/15 rounded-xl flex-shrink-0">
              <Icon size={22} className="text-red-400" />
            </div>
          </div>
        )}

        <h3 id="confirm-title" className="text-lg font-semibold text-white mb-2">
          {title}
        </h3>
        <p id="confirm-message" className="text-sm text-zinc-400 leading-relaxed">
          {message}
        </p>

        <div className="flex items-center justify-end gap-3 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm font-medium transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={onConfirm}
            className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-colors shadow-lg ${styles.button}`}
          >
            {variant === 'danger' && <Trash2 size={14} className="inline mr-2" />}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmContext
