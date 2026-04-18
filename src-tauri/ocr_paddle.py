#!/usr/bin/env python3
"""
PaddleOCR daemon called by the Tauri Rust backend.

Two modes:
  Single:  python3 ocr_paddle.py <image_path>
  Daemon:  python3 ocr_paddle.py --daemon
           Reads lines from stdin: each line is an image path.
           For each path, writes the result block to stdout:
             RESULT_START
             <text line 1>
             <text line 2>
             ...
             RESULT_END
           On error writes:
             RESULT_ERROR <message>

Exit codes (single mode): 0=ok  2=not installed  3=runtime error
"""
import sys
import os

os.environ.setdefault("GLOG_minloglevel", "3")
os.environ.setdefault("FLAGS_call_stack_level", "0")
os.environ.setdefault("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", "True")

def load_ocr(lang="en"):
    try:
        from paddleocr import PaddleOCR
    except ImportError:
        return None, "PADDLE_NOT_INSTALLED"
    import warnings, logging
    warnings.filterwarnings("ignore")
    logging.disable(logging.CRITICAL)
    try:
        ocr = PaddleOCR(
            lang=lang,
            text_detection_model_name="PP-OCRv5_mobile_det",  # 20x faster than server model
            use_doc_orientation_classify=False,
            use_doc_unwarping=False,             # product labels are flat, skip unwarping
            use_textline_orientation=False,
            text_det_limit_side_len=640,         # product labels don't need high res
            text_det_thresh=0.3,
        )
    except Exception as e:
        return None, str(e)
    return ocr, None

def run_ocr(ocr, img_path, min_confidence=0.5):
    if hasattr(ocr, "predict"):
        results = ocr.predict(img_path)
        lines = []
        for r in results:
            texts  = r.get("rec_texts",  [])
            scores = r.get("rec_scores", [])
            for text, score in zip(texts, scores):
                text = str(text).strip()
                if text and score >= min_confidence:
                    lines.append(text)
        return lines
    else:
        result = ocr.ocr(img_path, cls=False)
        lines = []
        if result and result[0]:
            for item in result[0]:
                if item and len(item) > 1 and item[1]:
                    text = str(item[1][0]).strip()
                    score = item[1][1] if len(item[1]) > 1 else 1.0
                    if text and score >= min_confidence:
                        lines.append(text)
        return lines

def daemon_mode():
    ocr_en, err = load_ocr("en")
    if err:
        print(f"DAEMON_ERROR {err}", flush=True)
        sys.exit(2 if "NOT_INSTALLED" in err else 3)

    # Indian-language models loaded lazily on first need (avoid startup cost)
    ocr_indian: dict = {}

    print("DAEMON_READY", flush=True)

    for line in sys.stdin:
        img_path = line.strip()
        if not img_path:
            continue
        try:
            lines = run_ocr(ocr_en, img_path)

            # If the English model found nothing, the image likely has only Indian
            # script text. Try Tamil, Telugu, Hindi models lazily.
            if not lines:
                for lang in ("ta", "te", "hi"):
                    if lang not in ocr_indian:
                        model, _err = load_ocr(lang)
                        ocr_indian[lang] = model  # None if unavailable
                    if ocr_indian.get(lang):
                        extra = run_ocr(ocr_indian[lang], img_path)
                        for t in extra:
                            if t not in lines:
                                lines.append(t)

            print("RESULT_START", flush=True)
            for l in lines:
                print(l, flush=True)
            print("RESULT_END", flush=True)
        except Exception as e:
            print(f"RESULT_ERROR {e}", flush=True)

def single_mode(img_path):
    ocr, err = load_ocr()
    if err:
        print(err, file=sys.stderr)
        sys.exit(2 if "NOT_INSTALLED" in err else 3)
    try:
        lines = run_ocr(ocr, img_path)
        print("\n".join(lines))
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(3)

if __name__ == "__main__":
    if len(sys.argv) >= 2 and sys.argv[1] == "--daemon":
        daemon_mode()
    elif len(sys.argv) >= 2:
        single_mode(sys.argv[1])
    else:
        print("ERROR: no image path", file=sys.stderr)
        sys.exit(1)
