import React, { useEffect, useCallback } from 'react';
import {
  AlertTriangle,
  XCircle,
  CheckCircle2,
  ArrowRight,
  X,
} from 'lucide-react';

export interface MissingRequirementItem {
  id: string;
  category: 'meter' | 'operator' | 'reading_error' | 'cash';
  title: string;
  detail: string;
  nozzleId?: string;
  rowIndex?: number;
}

interface CannotCloseDayModalProps {
  isOpen: boolean;
  onClose: () => void;
  missingItems: MissingRequirementItem[];
  onItemClick?: (item: MissingRequirementItem) => void;
}

export function CannotCloseDayModal({
  isOpen,
  onClose,
  missingItems = [],
  onItemClick,
}: CannotCloseDayModalProps) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const hasPendingItems = missingItems.length > 0;

  return (
    <div
      id="cannot-close-day-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cannot-close-modal-title"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[88vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-2xl"
      >
        {/* Header */}
        <div className="border-b-2 border-slate-100 px-7 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-2 ring-inset ring-amber-200">
                <AlertTriangle className="h-7 w-7" strokeWidth={2.2} />
              </div>

              <div className="min-w-0">
                <h3
                  id="cannot-close-modal-title"
                  className="text-2xl font-black tracking-tight text-slate-900"
                >
                  Cannot Close Day Yet
                </h3>
                <p className="mt-1 text-base font-medium text-slate-500">
                  Complete pending items before closing.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={onClose}
              className="fuel-close-button flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl text-slate-600"
              aria-label="Close"
            >
              <X className="h-6 w-6" aria-hidden="true" /> Close
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-7 py-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="text-lg font-black text-slate-900">
                Pending Requirements
              </p>
              <p className="mt-1 text-base font-medium text-slate-500">
                {hasPendingItems
                  ? 'These items need attention.'
                  : 'No pending requirements.'}
              </p>
            </div>

            <span className="flex h-11 min-w-11 items-center justify-center rounded-xl bg-slate-100 px-4 text-base font-black text-slate-700">
              {missingItems.length}
            </span>
          </div>

          <div className="space-y-3">
            {hasPendingItems ? (
              missingItems.map((item) => (
                <div
                  key={item.id}
                  onClick={() => item.rowIndex !== undefined && onItemClick?.(item)}
                  className={`flex items-start gap-4 rounded-2xl border-2 border-slate-200 bg-slate-50/60 p-5 transition-colors duration-200 hover:bg-slate-50 ${item.rowIndex !== undefined ? 'cursor-pointer hover:border-emerald-300' : ''}`}
                >
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-700 ring-2 ring-inset ring-amber-200">
                    <XCircle className="h-6 w-6" strokeWidth={2.2} />
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-base font-bold leading-6 text-slate-900">
                      {item.title}
                    </p>
                    <p className="mt-1 text-base font-medium leading-6 text-slate-500">
                      {item.detail}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border-2 border-emerald-200 bg-emerald-50/60 p-5">
                <div className="flex items-start gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                    <CheckCircle2 className="h-6 w-6" strokeWidth={2.2} />
                  </div>

                  <div>
                    <p className="text-base font-bold text-slate-900">
                      Everything is complete.
                    </p>
                    <p className="mt-1 text-base font-medium text-slate-600">
                      You can close today's operations.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>

          {hasPendingItems && (
            <div className="mt-6 rounded-2xl border-2 border-amber-200 bg-amber-50/70 p-5">
              <div className="flex items-start gap-3">
                <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-700" />

                <p className="text-base font-semibold leading-6 text-slate-700">
                  Complete all pending requirements before finalizing today's
                  operations.
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t-2 border-slate-100 bg-slate-50/50 px-7 py-5">
          <button
            type="button"
            id="btn-close-cannot-close-modal"
            onClick={onClose}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-xl bg-emerald-600 px-6 py-4 text-lg font-bold text-white shadow-sm transition-all duration-200 hover:bg-emerald-700 hover:shadow-md focus:outline-none focus:ring-4 focus:ring-emerald-100"
          >
            <span>Go Back</span>
            <ArrowRight className="h-6 w-6" />
          </button>
        </div>
      </div>
    </div>
  );
}
