package com.yukarusan.japaneseocr;

import androidx.annotation.Nullable;
import com.google.android.gms.tasks.Task;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.common.model.DownloadConditions;
import com.google.mlkit.common.model.RemoteModelManager;
import com.google.mlkit.nl.translate.TranslateLanguage;
import com.google.mlkit.nl.translate.TranslateRemoteModel;
import com.google.mlkit.nl.translate.Translation;
import com.google.mlkit.nl.translate.Translator;
import com.google.mlkit.nl.translate.TranslatorOptions;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * On-device Japanese → target language translation with ML Kit.
 */
class TranslationEngine {

    static final String DEFAULT_TARGET = TranslateLanguage.ENGLISH;

    private final Map<String, Translator> translators = new HashMap<>();

    /**
     * Maps a BCP-47 tag to an ML Kit language code.
     *
     * @return null when ML Kit does not support the language or it is Japanese itself
     */
    @Nullable
    static String resolveTarget(@Nullable String tag) {
        String language = TranslateLanguage.fromLanguageTag(tag == null || tag.isEmpty() ? DEFAULT_TARGET : tag);
        if (language == null || TranslateLanguage.JAPANESE.equals(language)) {
            return null;
        }
        return language;
    }

    Task<Void> download(String target, boolean requireWifi) {
        DownloadConditions.Builder conditions = new DownloadConditions.Builder();
        if (requireWifi) {
            conditions.requireWifi();
        }
        return translator(target).downloadModelIfNeeded(conditions.build());
    }

    Task<Boolean> isReady(String target) {
        RemoteModelManager manager = RemoteModelManager.getInstance();
        Task<Boolean> source = manager.isModelDownloaded(new TranslateRemoteModel.Builder(TranslateLanguage.JAPANESE).build());
        Task<Boolean> dest = manager.isModelDownloaded(new TranslateRemoteModel.Builder(target).build());
        return Tasks.<Boolean>whenAllSuccess(source, dest).continueWith((task) -> {
            for (Boolean downloaded : task.getResult()) {
                if (!Boolean.TRUE.equals(downloaded)) return false;
            }
            return true;
        });
    }

    Task<String> translate(String target, String text) {
        return translator(target).translate(text);
    }

    Task<List<String>> translateAll(String target, List<String> texts) {
        if (texts.isEmpty()) {
            return Tasks.forResult(Collections.emptyList());
        }
        Translator translator = translator(target);
        List<Task<String>> tasks = new ArrayList<>();
        for (String text : texts) {
            tasks.add(translator.translate(text));
        }
        return Tasks.whenAllSuccess(tasks);
    }

    synchronized void close() {
        for (Translator translator : translators.values()) {
            translator.close();
        }
        translators.clear();
    }

    private synchronized Translator translator(String target) {
        Translator translator = translators.get(target);
        if (translator == null) {
            TranslatorOptions options = new TranslatorOptions.Builder()
                .setSourceLanguage(TranslateLanguage.JAPANESE)
                .setTargetLanguage(target)
                .build();
            translator = Translation.getClient(options);
            translators.put(target, translator);
        }
        return translator;
    }
}
