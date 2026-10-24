import React, { useState, useRef } from 'react';
import { Upload, X, FileText } from 'lucide-react';
import { parseLeadsFile, ParseLeadsReport } from '../../lib/lead-parser';

interface CsvUploaderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (recipients: string[]) => void;
}

export function CsvUploaderModal({ isOpen, onClose, onImport }: CsvUploaderModalProps) {
  const [report, setReport] = useState<ParseLeadsReport | null>(null);
  const [filename, setFilename] = useState<string>('');
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const handleFile = (file: File) => {
    if (!file) return;
    setFilename(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (content) {
        const parsed = parseLeadsFile(content);
        setReport(parsed);
      }
    };
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFile(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmImport = () => {
    if (report && report.validEmails.length > 0) {
      onImport(report.validEmails);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs select-none">
      <div className="bg-white rounded-2xl w-full max-w-md p-6 border border-gray-100 shadow-2xl relative">

        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-bold text-gray-900">Upload Leads List</h3>
            <p className="text-xs text-gray-500 mt-0.5">Upload a CSV or TXT file of email leads</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-gray-700 rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="py-5">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.txt,text/plain,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-[#00A859] bg-[#E8F8F0]'
                : 'border-gray-200 hover:border-[#A7F3D0] hover:bg-[#E8F8F0]/30'
            }`}
          >
            <div className="w-10 h-10 rounded-full bg-[#E8F8F0] text-[#00A859] flex items-center justify-center mx-auto mb-2">
              <Upload className="w-5 h-5" />
            </div>
            <p className="text-xs font-semibold text-gray-800">
              Click to browse or drag and drop
            </p>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Supports CSV or plain text (.csv, .txt)
            </p>
          </div>

          {report && (
            <div className="mt-4 p-3.5 bg-gray-50 rounded-xl border border-gray-100 space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-gray-700 flex items-center gap-1.5 truncate">
                  <FileText className="w-3.5 h-3.5 text-[#00A859]" />
                  <span>{filename}</span>
                </span>
                <span className="text-[11px] text-gray-400 font-medium">
                  {report.totalDetected} detected
                </span>
              </div>

              <div className="grid grid-cols-3 gap-2 pt-1 text-center text-xs">
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Valid</p>
                  <p className="text-xs font-bold text-[#00A859]">{report.validEmails.length}</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Duplicates</p>
                  <p className="text-xs font-bold text-amber-600">{report.duplicateCount}</p>
                </div>
                <div className="bg-white p-2 rounded-lg border border-gray-100">
                  <p className="text-[10px] text-gray-400 uppercase font-semibold">Invalid</p>
                  <p className="text-xs font-bold text-red-500">{report.invalidLines.length}</p>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-3 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!report || report.validEmails.length === 0}
            onClick={handleConfirmImport}
            className="bg-[#00A859] hover:bg-[#00924c] text-white text-xs font-semibold px-4 py-1.5 rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
          >
            Import {report ? `${report.validEmails.length} Leads` : ''}
          </button>
        </div>
      </div>
    </div>
  );
}
