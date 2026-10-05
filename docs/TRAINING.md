# SatQuery AI — Training & Domain Adaptation Specification

**Target Datasets:** RSVQA-LR, BigEarthNet-MM, CDVQA  
**Target Infrastructure:** Google Colab (NVIDIA T4 / A100 GPU)  
**Configuration Standards:** Dataset-driven, reproducible, fail-fast on missing data

---

## 1. Google Colab Environment Setup

To train or fine-tune remote sensing adapters on Google Colab:

```bash
# 1. Clone repository
!git clone https://github.com/Miruthula426/satellite-photo-explorer.git
%cd satellite-photo-explorer

# 2. Install dependencies
!pip install -r backend/requirements.txt
!pip install peft accelerate bitsandbytes

# 3. Mount Google Drive for persistent datasets & checkpoints
from google.colab import drive
drive.mount('/content/drive')
```

---

## 2. Standardized Hyperparameters

Every training execution requires an explicit configuration manifest:

| Parameter | Recommended Default | Description |
| :--- | :--- | :--- |
| `DATASET_PATH` | `/content/drive/MyDrive/data/rsvqa` | Path to physical satellite imagery and annotations |
| `MODEL_NAME` | `microsoft/Florence-2-base` | Base open-source vision-language model |
| `OUTPUT_DIR` | `/content/drive/MyDrive/checkpoints/` | Persistent directory for saved checkpoint `.pt` files |
| `SEED` | `42` | Random seed for Python, NumPy, and PyTorch (deterministic cuDNN) |
| `BATCH_SIZE` | `8` (T4) / `32` (A100) | Training batch size |
| `LEARNING_RATE` | `2e-4` | Peak AdamW learning rate |
| `EPOCHS` | `10` | Maximum training epochs |
| `LORA_R` | `16` | Low-Rank Adaptation rank dimension |
| `LORA_ALPHA` | `32` | LoRA scaling factor |

---

## 3. Dataset Directory Structure (RSVQA / BigEarthNet)

Do not fabricate sample labels or imagery. The directory structure expected by `train_adapter.py` is:

```text
data/rsvqa/
├── Images/
│   ├── sentinel2_tile_001.tif
│   └── sentinel2_tile_002.tif
├── train_manifest.json
└── val_manifest.json
```

Where `train_manifest.json` contains:
```json
[
  {
    "image_path": "Images/sentinel2_tile_001.tif",
    "question": "Is there a river visible?",
    "answer": "yes"
  }
]
```

---

## 4. Colab Notebook Sequence

Execute the notebook sequence in order:

1. [`training/notebooks/01_dataset_exploration.ipynb`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/notebooks/01_dataset_exploration.ipynb): Inspect physical raster bands, histograms, and spatial resolutions.
2. [`training/notebooks/02_preprocessing.ipynb`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/notebooks/02_preprocessing.ipynb): Apply 2-98 percentile normalization, cloud masking, and decibel (dB) SAR transformation.
3. [`training/notebooks/03_remote_sensing_adaptation.ipynb`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/notebooks/03_remote_sensing_adaptation.ipynb): Attach LoRA adapters to cross-attention and projection layers.
4. [`training/notebooks/04_training.ipynb`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/notebooks/04_training.ipynb): Run PyTorch training loop; fail fast if dataset is unmounted; export checkpoints.
5. [`training/notebooks/05_evaluation.ipynb`](file:///c:/Users/omesh/Downloads/satellite-photo-explorer/training/notebooks/05_evaluation.ipynb): Compute empirical Top-1 accuracy, BLEU, and Mean IoU on held-out test splits.

---

## 5. Command-Line Training Execution

To run training directly via CLI on Colab or a private GPU server:

```bash
python training/scripts/train_adapter.py \
  --config training/configs/rsvqa_lora_config.yaml \
  --data-dir /content/drive/MyDrive/data/rsvqa
```

If the dataset path does not exist, the script terminates immediately with `FileNotFoundError`, ensuring zero fabricated training results.
