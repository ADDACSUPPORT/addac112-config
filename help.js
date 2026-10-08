// Descriptions shown by the (i) buttons. Based on the module's own option descriptions (gui.cpp,
// get_option_description_) and on what the firmware does with each value. Keys: field keys in cfg.js,
// plus a few for the loops, scales and global editors.
(function (root) {
    'use strict';

    const HELP = {
        // ---- rec settings ----
        stereo: 'Record in mono or stereo.',
        samplerate: 'Samplerate of the module. Lower rates allow more grains and longer loops (and sound grittier); higher rates use more CPU and allow fewer grains.',
        bit_depth: 'Bit depth of new recordings: 8, 16 or 24 bits. Lower depths use less memory.',
        antialiasing: 'Anti-aliasing filter on playback. Turn it off to save CPU, at the cost of more aliasing when pitching up.',
        overdub_origin: 'Where overdubs are written: at the play head, at the rec head, or both.',
        resampling_pitch: 'While recording over a playing loop: FIXED AT 0 records at the original pitch; FOLLOWS LOOP records at the same pitch the loop is playing at.',
        rec_dir_en: 'Allow the DIRECTION button to change the recording direction too (record in reverse).',
        rec_vol_pre_post: 'Whether the recorded input is taken before (PRE) or after (POST) the DRY volume knob.',

        // ---- pitch settings ----
        pitch_range_octaves: 'Range of the pitch knobs and CVs: -24 to +36 semitones (1 V/oct over 5 octaves), -12 to +12, -2 to +2, or from stopped (-INF) to +24.',
        pitch_zero_notch: 'Snap the pitch to exactly 0 (original pitch) when it is within about 30 cents of it, so the centre is easy to find.',
        pitch_direction_ctrl: 'Use the pitch control as a direction and speed control: below the centre plays in reverse, above plays forward. At the extremes, NARROW reaches normal speed and WIDE double speed.',
        pitch_mode: 'How the loop is pitched. SAMPLERATE changes speed and pitch together (tape style). PITCH SHIFT changes pitch at the same speed. TIME STRETCH changes speed at the same pitch. PITCH/TIME SIM and PITCH AND TIME combine both (in PITCH AND TIME, the REC PROB knob controls the time stretch).',
        pitch_mode_grains: 'How grains are pitched: SAMPLERATE (speed and pitch together), PITCH SHIFT or TIME STRETCH. PITCH SHIFT and TIME STRETCH limit the module to 3 grains.',
        pitch_buf_size: 'Buffer size of the pitch shifter and time stretcher (SHORT, MEDIUM or LONG).',
        quant_mode: 'What the scale quantizer (QUANTIZE knob) applies to: loops and grains, loops only, or grains only.',
        scales_set: 'Which set of 7 scales the QUANTIZE knob uses: the DEFAULT set or the CUSTOM set. Both are edited in the Scales tab.',

        // ---- grains settings ----
        grains_samplerate_mode: 'Grains play at the full samplerate, half or a quarter of it. Lower rates allow 2 or 4 times more grains.',
        keep_grain_pitch: 'KEEP: a playing grain keeps its pitch and pitch changes apply to new grains. CHANGE: pitch changes also apply to grains already playing.',
        grain_trigger_mode: 'When ON, grains start on pulses at the grains trigger input instead of on their own.',
        grains_length_mode: 'DEFAULT: grain length changes with grain pitch (higher pitch, shorter grain). KEEP LENGTH: grains keep their length whatever the pitch.',
        grain_dev_mode: 'How the DEV knobs spread grains: RANDOM picks a random value for each grain; SPREAD spaces the grains evenly across the deviation range.',
        grain_pan_mode: 'FIXED: each grain keeps the pan position it starts with. TRAVEL: grains move across the stereo field while they play (uses more CPU).',
        pos_follow_loop: 'When ON, the grains POSITION follows the loop play head, so grains play around the part of the loop being heard.',
        max_grain_delay: 'Longest time the DELAY knob reaches: 5 seconds, 30 seconds, or the loop size.',
        grain_delay_mode: 'PER GRAIN: DELAY is each grain\'s rest after it ends. ABSOLUTE: DELAY is the time between new grains, and N GRAINS caps how many play at once.',
        grain_pos_mode: 'WINDOW: POSITION places the grain inside the space left after it, so changing SIZE moves the grain start. FIXED START: POSITION is the grain start and SIZE never moves it; grains past the loop end are cut short.',

        // ---- other settings ----
        clocked_mode: 'Use the STOP button / input as a clock. Not available together with AUTOREC or TIME GRID: turning it on turns those off.',
        pause_mode: 'PAUSE button behaviour: TOGGLE (press to pause, press again to play) or MOMENTARY (paused only while held).',
        trigger_size_ms: 'Length of the pulses sent by the trigger outputs.',
        special_functions: 'Enable or disable the shortcuts: KILL ALL GRAINS (MENU + STOP), DUPLICATE loop (MENU + REC) and NORMALIZE loop (MENU + PLAY).',
        '@autorec': 'Start recording automatically when the input goes above AUTOREC THRES: for NEW REC, for REC (overdub), or both. Not available with CLOCKED MODE.',
        autorec_threshold_db: 'Input level that starts an automatic recording (AUTOREC), from -54 dB to 0 dB.',
        edit_with_pots: 'Loop editing with the knobs: OFF, POS/SIZE (move the loop window and set its size) or START/END (set the start and end points independently).',

        // ---- time grid & triggers ----
        time_grid_divisions: 'Divide the loop into 1 to 32 steps. PLAY/PAUSE, REC and DIRECTION blink and wait for the next step to apply; STOP stays immediate. Not available with CLOCKED MODE.',
        grid_pitch_sh_mode: 'With TIME GRID on, hold the loop and/or grain pitch and only update it on each grid step (sample & hold).',
        loop_cycle_mode: 'When ON, a pulse at the loop select CV input advances to the next loop, wrapping back to the first after the last.',
        env_trigger_mode: 'When ON, the input level is followed and the module advances to the next loop each time it rises above ENV THRESHOLD (during playback).',
        env_trigger_threshold_db: 'Input level that fires the ENV TRIGGER, from -54 dB to 0 dB. It fires once per crossing, then re-arms when the level falls back.',
        env_trigger_probability: 'Chance that an ENV TRIGGER crossing actually advances the loop, 0-100 %.',
        env_trigger_response_ms: 'Smoothing of the input level before it is compared with the threshold: INSTANT reacts to every peak, up to 10 ms ignores very short transients.',

        // ---- pitch motor ----
        pitch_motor_mode: 'Pitch changes glide like a motor speeding up and slowing down, for the loop, the grains or both. Sets LOOP PITCH MODE to SAMPLERATE, OVERDUB ORIGIN to REC HEAD and RESAMPLING PITCH to FIXED AT 0.',
        pitch_motor_acceleration: 'How long the pitch motor takes to speed up. 100 is slowest.',
        pitch_motor_decceleration: 'How long the pitch motor takes to slow down. 100 is slowest.',
        pitch_motor_start_stop: 'When ON, PLAY and STOP spin the motor up and down (like a turntable) instead of starting and stopping at once.',

        // ---- presets (bank-wide) ----
        vols_in_presets: 'Which volumes presets recall. Unchecked volumes always follow their knob, whatever preset is selected.',
        preset_override: 'Controls listed here follow their knob/CV right after a preset change. The others keep the preset value until you turn the knob past it.',

        // ---- compressors ----
        scc_state: 'Sidechain compressor: the input ducks the grains, the loop, or both.',
        scc_attack: 'How fast the sidechain compressor reacts when the input gets louder.',
        scc_release: 'How fast the sidechain compressor lets go when the input gets quieter.',
        scc_ratio: 'How much the sidechain compressor reduces the level above the threshold (8:1 means 8 dB over becomes 1 dB over).',
        scc_threshold: 'Input level above which the sidechain compressor starts ducking.',
        scc_makeup_gain: 'Gain added after the sidechain compressor. AUTO sets it from the threshold and ratio.',
        compressor_input_state: 'Compressor on the audio input, before it is recorded.',
        compressor_input_attack: 'How fast the input compressor reacts when the input gets louder.',
        compressor_input_release: 'How fast the input compressor lets go when the input gets quieter.',
        compressor_input_ratio: 'How much the input compressor reduces the level above the threshold.',
        compressor_input_threshold: 'Input level above which the input compressor starts compressing.',
        compressor_input_makeup_gain: 'Gain added after the input compressor. AUTO sets it from the threshold and ratio.',

        // ---- display ----
        '@screensaver': 'Show the screensaver after this long without touching the module, or never (OFF).',

        // ---- preset knobs and switches ----
        pos: 'GRAIN POSITION knob: where in the loop grains are taken from.',
        pos_dev: 'POSITION DEV knob: how far each grain\'s position can move away from POSITION.',
        length: 'GRAIN SIZE knob: grain length, relative to the loop.',
        length_dev: 'SIZE DEV knob: how much each grain\'s size can vary from SIZE.',
        delay: 'DELAY knob: time between grains (see GRAIN DELAY MODE), in milliseconds. Capped by MAX GRAIN DELAY.',
        delay_dev: 'DELAY DEV knob: how much each grain\'s delay can vary from DELAY.',
        n_grains: 'N GRAINS knob: how many grains play. The most depends on SAMPLERATE, GRAINS SAMPLERATE and GRAIN PITCH MODE.',
        direction: 'Grain direction knob: below 10 % all grains play in reverse, above 90 % all play forward, in between a random mix weighted towards the knob position.',
        repeat_mode: 'Grain repeat switch: PROBABILITY (REPEAT is the chance a grain repeats) or N TIMES (REPEAT sets how many times each grain repeats).',
        repeats: 'REPEAT knob: repeat probability or number of repeats, depending on REPEAT MODE.',
        attack: 'ATTACK knob: grain fade-in, as a part of the grain length.',
        decay: 'DECAY knob: grain fade-out, as a part of the grain length.',
        vol_min: 'VOL MIN knob: the quietest a grain can be.',
        vol_dev: 'VOL DEV knob: how much grain volume can vary between VOL MIN and full.',
        grain_pan: 'PAN knob: below the centre, grains spread randomly around the middle; above it, they are pushed towards the left and right edges.',
        loop_pitch: 'LOOP PITCH knob, in semitones (0 = original pitch).',
        grain_pitch: 'GRAIN PITCH knob, in semitones (0 = original pitch).',
        quantizer: 'QUANTIZE knob: OFF (free pitch) or one of the 7 scales of the set chosen by SCALES SET.',
        rec_prob: 'REC PROB knob: chance that each pass of the loop is recorded (100 % = every pass).',
        rec_delay: 'REC DELAY knob: wait between recordings, relative to the loop length.',
        rec_delay_dev: 'REC DELAY DEV knob: random variation added to REC DELAY each time.',
        rec_mode: 'After-rec switch: what happens when a recording ends: keep recording (REC), PLAY the loop, or STOP.',
        rec_sync: 'Rec-from-play-head switch: when ON, recording starts at the play head position instead of the rec head\'s own position.',
        loop_play_mode: 'Play switch: PLAY starts the loop from its START, or from the LAST POSITION it stopped at.',
        pause_retrigger: 'Retrigger switch: pressing PLAY while playing restarts the loop from its start (PLAY FROM START) or pauses it (PAUSE).',
        on_loop_change_mode: 'Loop change switch: a new loop starts IMMEDIATELY when selected, or AT LOOP END of the current one.',
        loop_direction: 'Loop playback direction when the preset loads.',
        vol_in: 'DRY volume: the input level sent to the outputs.',
        vol_loop: 'LOOP volume.',
        vol_grains: 'GRAINS volume.',
        overdub_decay: 'OVERDUB knob: how much of the old loop is kept when recording over it (100 % keeps everything, lower values fade it).',
        feedback: 'FEEDBACK knob: how much of the grains is recorded back into the loop.',

        // ---- editors ----
        loops: 'The loops this preset uses, in LOOP SELECT order (WAV files in the bank\'s WAV folder). "start" marks the loop selected when the preset loads.',
        scale_name: 'Scale name shown on the module\'s top bar, up to 12 characters.',
        scale_ratios: 'Frequency ratios of the scale notes, relative to the root (1). Type decimals or fractions such as 9/8 or 3:2, separated by commas. The cents value of each ratio is shown below.',
        scale_per_octave: 'PER OCTAVE: the ratios form one octave (between 1 and 2) and repeat in every octave. ABSOLUTE: the ratios are used as they are across the whole range (e.g. the HARMONIC series 1, 2, 3...).',
        bank_at_start: 'The bank the 112 loads when it starts. Only folders named BANK followed by a number can be loaded.',
        out_gain_l: 'Output level of the left channel, from silent to +3.5 dB.',
        out_gain_r: 'Output level of the right channel, from silent to +3.5 dB.',
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = HELP;
    else root.Help112 = HELP;
})(typeof window !== 'undefined' ? window : globalThis);
